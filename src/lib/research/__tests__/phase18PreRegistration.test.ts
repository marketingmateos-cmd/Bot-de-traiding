import { describe, expect, it } from "vitest";
import { FROZEN_DATASET, FROZEN_RANGES, FROZEN_STRATEGY_MANIFEST, FROZEN_STRATEGY_IDS, FROZEN_WALK_FORWARD_OPTIONS, FROZEN_RISK_PROFILE } from "../phase18PreRegistration";

describe("Fase 18 pre-registration — frozen manifest", () => {
  it("freezes exactly the 9 strategies (4 baselines + 5 research), in a fixed order", () => {
    expect(FROZEN_STRATEGY_IDS).toEqual([
      "breakout-baseline-v1",
      "momentum-baseline-v1",
      "mean-reversion-baseline-v1",
      "trend-following-baseline-v1",
      "research-volatility-squeeze-v1",
      "research-volume-confirmation-v1",
      "research-trend-pullback-v1",
      "research-breakout-confirmation-v1",
      "research-momentum-reversal-v1",
    ]);
    expect(FROZEN_STRATEGY_MANIFEST).toHaveLength(9);
  });

  it("every manifest entry carries a real strategyConfigHash and non-empty defaultParams", () => {
    for (const s of FROZEN_STRATEGY_MANIFEST) {
      expect(s.strategyConfigHash).toMatch(/^[0-9a-f]{8}$/);
      expect(Object.keys(s.defaultParams).length).toBeGreaterThan(0);
    }
  });

  it("the 5 research strategies carry a family/hypothesis; the 4 baselines do not (no Fase 17 hypothesis registry entry for them)", () => {
    const research = FROZEN_STRATEGY_MANIFEST.filter((s) => s.strategyId.startsWith("research-"));
    const baseline = FROZEN_STRATEGY_MANIFEST.filter((s) => s.strategyId.endsWith("-baseline-v1"));
    expect(research).toHaveLength(5);
    expect(baseline).toHaveLength(4);
    for (const s of research) {
      expect(s.family).not.toBeNull();
      expect(s.hypothesis).not.toBeNull();
    }
  });

  it("freezes the exact dataset hash from Fase 16 and the exact date range", () => {
    expect(FROZEN_DATASET.datasetHash).toBe("8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503");
    expect(FROZEN_DATASET.startDate.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(FROZEN_DATASET.endDate.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(FROZEN_DATASET.rowCount).toBe(4416);
  });

  it("IS/VALIDATION/OOS ranges are chronological, non-overlapping, with exactly a 1-hour (1 H1 candle) gap at each boundary", () => {
    expect(FROZEN_RANGES.is.start.getTime()).toBe(FROZEN_DATASET.startDate.getTime());
    expect(FROZEN_RANGES.oos.end.getTime()).toBe(FROZEN_DATASET.endDate.getTime());
    expect(FROZEN_RANGES.is.end.getTime()).toBeLessThan(FROZEN_RANGES.validation.start.getTime());
    expect(FROZEN_RANGES.validation.start.getTime() - FROZEN_RANGES.is.end.getTime()).toBe(3_600_000);
    expect(FROZEN_RANGES.validation.end.getTime()).toBeLessThan(FROZEN_RANGES.oos.start.getTime());
    expect(FROZEN_RANGES.oos.start.getTime() - FROZEN_RANGES.validation.end.getTime()).toBe(3_600_000);
  });

  it("freezes the exact same risk/evaluation profile as the Fase 11/17 benchmarks (20K, Risk Level 5, HISTORICAL_REAL, DETERMINISTIC_AI)", () => {
    expect(FROZEN_RISK_PROFILE).toEqual({ evaluationProfileType: "20K", riskLevel: 5, dataSource: "HISTORICAL_REAL", aiMode: "DETERMINISTIC_AI" });
  });

  it("reuses Fase 13's own supplementary walk-forward options unchanged", () => {
    expect(FROZEN_WALK_FORWARD_OPTIONS).toEqual({ windowSizeDays: 90, trainFraction: 0.7, stepDays: 45 });
  });
});
