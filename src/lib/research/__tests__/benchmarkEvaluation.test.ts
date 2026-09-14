import { describe, expect, it } from "vitest";
import { evaluateBenchmarkRun, type BenchmarkEvaluationProfile } from "../benchmarkEvaluation";

const PROFILE: BenchmarkEvaluationProfile = {
  initialBalance: 20000,
  phase: "PHASE_1",
  phase1TargetPct: 10,
  phase2TargetPct: 5,
  dailySafetyPct: -3,
  dailyHardPct: -5,
  totalSafetyPct: -6,
  totalHardPct: -10,
  baseRiskPct: 1,
  minRRR: 1.5,
  resetHourUtc: 0,
};

function point(t: string, equity: number) {
  return { t: new Date(t).getTime(), equity };
}

describe("Fase 11 — evaluateBenchmarkRun: PASS", () => {
  it("PASS when the equity curve reaches the +10% target before any hard breach", () => {
    const curve = [point("2026-03-01T00:00:00Z", 20000), point("2026-03-15T00:00:00Z", 20800), point("2026-04-01T00:00:00Z", 22000)];
    const result = evaluateBenchmarkRun(curve, PROFILE);
    expect(result.status).toBe("PASS");
    expect(result.targetReachedAt).not.toBeNull();
    expect(result.daysToTarget).toBeGreaterThanOrEqual(1);
    expect(result.failedAt).toBeNull();
  });
});

describe("Fase 11 — evaluateBenchmarkRun: FAIL", () => {
  it("FAIL on a total hard-stop breach (-10%)", () => {
    const curve = [point("2026-03-01T00:00:00Z", 20000), point("2026-03-10T00:00:00Z", 19000), point("2026-03-20T00:00:00Z", 17900)];
    const result = evaluateBenchmarkRun(curve, PROFILE);
    expect(result.status).toBe("FAIL");
    expect(result.failedAt).not.toBeNull();
    expect(result.failureReason).toMatch(/TOTAL_HARD_STOP/);
    expect(result.totalStopTriggered).toBe(true);
  });

  it("FAIL on a daily hard-stop breach (-5%) within a single UTC day", () => {
    const curve = [
      point("2026-03-01T01:00:00Z", 20000), // establishes dayStartEquity
      point("2026-03-01T05:00:00Z", 18900), // -5.5% same day
      point("2026-03-01T10:00:00Z", 19500), // recovers slightly, but FAILED is sticky
    ];
    const result = evaluateBenchmarkRun(curve, PROFILE);
    expect(result.status).toBe("FAIL");
    expect(result.failureReason).toMatch(/DAILY_HARD_STOP/);
    expect(result.dailyStopTriggered).toBe(true);
  });

  it("never labeled FAIL just because the target wasn't reached — it must be an actual hard breach", () => {
    const curve = [point("2026-03-01T00:00:00Z", 20000), point("2026-04-01T00:00:00Z", 20100)]; // +0.5%, flat, no breach either way
    const result = evaluateBenchmarkRun(curve, PROFILE);
    expect(result.status).not.toBe("FAIL");
  });
});

describe("Fase 11 — evaluateBenchmarkRun: INCONCLUSIVE", () => {
  it("INCONCLUSIVE when the run ends with neither target nor failure", () => {
    const curve = [point("2026-03-01T00:00:00Z", 20000), point("2026-05-01T00:00:00Z", 20800)]; // +4%, never reaches +10% nor breaches -10%
    const result = evaluateBenchmarkRun(curve, PROFILE);
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.targetReachedAt).toBeNull();
    expect(result.failedAt).toBeNull();
  });

  it("INCONCLUSIVE (empty) for an empty equity curve, never fabricated", () => {
    const result = evaluateBenchmarkRun([], PROFILE);
    expect(result.status).toBe("INCONCLUSIVE");
  });
});

describe("Fase 11 — evaluateBenchmarkRun: target reached before a later dip is never re-evaluated as FAIL (sticky)", () => {
  it("PASS survives even if equity crashes hard after the target was already reached", () => {
    const curve = [
      point("2026-03-01T00:00:00Z", 20000),
      point("2026-03-15T00:00:00Z", 22000), // +10% target reached
      point("2026-04-01T00:00:00Z", 15000), // huge crash AFTER target — must not flip the outcome to FAIL
    ];
    const result = evaluateBenchmarkRun(curve, PROFILE);
    expect(result.status).toBe("PASS");
  });
});

describe("Fase 11 — evaluateBenchmarkRun: maxDailyDrawdownPct", () => {
  it("reports the single worst dailyPnlPct observed across the whole run", () => {
    const curve = [
      point("2026-03-01T01:00:00Z", 20000),
      point("2026-03-01T05:00:00Z", 19400), // -3% that day
      point("2026-03-02T01:00:00Z", 19400), // new day resets dayStartEquity
      point("2026-03-02T05:00:00Z", 18800), // -3.09% that (second) day
    ];
    const result = evaluateBenchmarkRun(curve, PROFILE);
    expect(result.maxDailyDrawdownPct).toBeLessThan(-3);
    expect(result.maxDailyDrawdownPct).toBeGreaterThan(-4);
  });
});
