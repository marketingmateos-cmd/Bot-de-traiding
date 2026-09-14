import { describe, expect, it } from "vitest";
import {
  EVALUATION_PROFILE_TEMPLATES,
  computeEvaluationDayKey,
  evaluateEvaluationAccount,
  resolveEvaluationTemplate,
  type EvaluationAccountState,
} from "../evaluationRiskEngine";

function baseAccount(overrides: Partial<EvaluationAccountState> = {}): EvaluationAccountState {
  return {
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
    status: "ACTIVE",
    dayStartEquity: 20000,
    ...overrides,
  };
}

describe("MT5 Fase 2, spec section 1 — evaluation profile templates", () => {
  it("20K/50K/100K templates share every rule except initialBalance", () => {
    expect(EVALUATION_PROFILE_TEMPLATES["20K"].initialBalance).toBe(20000);
    expect(EVALUATION_PROFILE_TEMPLATES["50K"].initialBalance).toBe(50000);
    expect(EVALUATION_PROFILE_TEMPLATES["100K"].initialBalance).toBe(100000);
    for (const key of ["20K", "50K", "100K"] as const) {
      const t = EVALUATION_PROFILE_TEMPLATES[key];
      expect(t.phase1TargetPct).toBe(10);
      expect(t.phase2TargetPct).toBe(5);
      expect(t.dailySafetyPct).toBe(-3);
      expect(t.dailyHardPct).toBe(-5);
      expect(t.totalSafetyPct).toBe(-6);
      expect(t.totalHardPct).toBe(-10);
      expect(t.baseRiskPct).toBe(1);
      expect(t.minRRR).toBe(1.5);
    }
  });

  it("resolveEvaluationTemplate('CUSTOM') requires explicit values, never assumes defaults silently", () => {
    expect(() => resolveEvaluationTemplate("CUSTOM")).toThrow(/valores explícitos/);
  });

  it("resolveEvaluationTemplate('CUSTOM') builds a template from caller-supplied overrides", () => {
    const custom = resolveEvaluationTemplate("CUSTOM", { initialBalance: 7500, baseRiskPct: 2, minRRR: 2 });
    expect(custom.profileType).toBe("CUSTOM");
    expect(custom.initialBalance).toBe(7500);
    expect(custom.baseRiskPct).toBe(2);
    expect(custom.minRRR).toBe(2);
    // Unspecified fields fall back to the shared base template, not to zero/undefined.
    expect(custom.phase1TargetPct).toBe(10);
    expect(custom.dailyHardPct).toBe(-5);
  });

  it("resolveEvaluationTemplate('20K'/'50K'/'100K') returns the exact matching template", () => {
    expect(resolveEvaluationTemplate("50K")).toEqual(EVALUATION_PROFILE_TEMPLATES["50K"]);
  });
});

describe("MT5 Fase 2, spec section 1/12 — Phase 1 / Phase 2 targets", () => {
  it("PHASE_1 target is +10%: below it stays ACTIVE", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ phase: "PHASE_1" }), currentEquity: 21900 }); // +9.5%
    expect(result.status).toBe("ACTIVE");
    expect(result.newlyTargetReached).toBe(false);
  });

  it("PHASE_1 target is +10%: reaching it fires TARGET_REACHED", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ phase: "PHASE_1" }), currentEquity: 22000 }); // exactly +10%
    expect(result.status).toBe("TARGET_REACHED");
    expect(result.newlyTargetReached).toBe(true);
  });

  it("PHASE_2 target is +5%, distinct from PHASE_1's +10%", () => {
    // +4% — below PHASE_2's own +5% target (would also be below PHASE_1's +10%).
    const stillActive = evaluateEvaluationAccount({ account: baseAccount({ phase: "PHASE_2" }), currentEquity: 20800 });
    expect(stillActive.status).toBe("ACTIVE");

    // +6% — above PHASE_2's +5% target (but would still be below PHASE_1's +10%,
    // proving PHASE_2 really uses its own, lower target, not PHASE_1's).
    const reached = evaluateEvaluationAccount({ account: baseAccount({ phase: "PHASE_2" }), currentEquity: 21200 });
    expect(reached.status).toBe("TARGET_REACHED");
  });

  it("TARGET_REACHED is sticky: equity dipping back below target never resumes ACTIVE", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ status: "TARGET_REACHED" }), currentEquity: 20500 }); // barely above initial, well below the target it already hit
    expect(result.status).toBe("TARGET_REACHED");
    expect(result.blockNewEntries).toBe(true);
    expect(result.newlyTargetReached).toBe(false); // not a FRESH transition — already was TARGET_REACHED
  });
});

describe("MT5 Fase 2, spec section 1 — daily safety / daily hard stop", () => {
  it("daily safety stop (-3%) blocks new entries but does not fail the evaluation", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ dayStartEquity: 20000 }), currentEquity: 19350 }); // -3.25% daily
    expect(result.status).toBe("ACTIVE");
    expect(result.blockNewEntries).toBe(true);
  });

  it("daily hard stop (-5%) FAILS the evaluation outright, not just blocks today", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ dayStartEquity: 20000 }), currentEquity: 18900 }); // -5.5% daily
    expect(result.status).toBe("FAILED");
    expect(result.newlyFailedReason).toMatch(/DAILY_HARD_STOP/);
  });

  it("daily P&L% is null (no block) when dayStartEquity hasn't been established yet", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ dayStartEquity: null }), currentEquity: 19000 });
    expect(result.dailyPnlPct).toBeNull();
    expect(result.blockNewEntries).toBe(false);
  });
});

describe("MT5 Fase 2, spec section 1/13 — total safety / total hard stop", () => {
  it("total safety stop (-6%) halves currentRiskPct with reason TOTAL_DRAWDOWN_PROTECTION", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ baseRiskPct: 1, dayStartEquity: null }), currentEquity: 18700 }); // -6.5% total
    expect(result.status).toBe("ACTIVE");
    expect(result.currentRiskPct).toBe(0.5);
    expect(result.currentRiskReason).toBe("TOTAL_DRAWDOWN_PROTECTION");
  });

  it("above the total safety stop, currentRiskPct stays at baseRiskPct with reason BASE_RISK", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ baseRiskPct: 1, dayStartEquity: null }), currentEquity: 19600 }); // -2% total
    expect(result.currentRiskPct).toBe(1);
    expect(result.currentRiskReason).toBe("BASE_RISK");
  });

  it("total hard stop (-10%) FAILS the evaluation", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ dayStartEquity: null }), currentEquity: 17900 }); // -10.5% total
    expect(result.status).toBe("FAILED");
    expect(result.newlyFailedReason).toMatch(/TOTAL_HARD_STOP/);
  });

  it("FAILED is sticky: equity recovering fully afterwards never un-fails the evaluation", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ status: "FAILED" }), currentEquity: 25000 }); // well above initial
    expect(result.status).toBe("FAILED");
    expect(result.blockNewEntries).toBe(true);
    expect(result.newlyFailedReason).toBeNull(); // not a fresh transition
  });

  it("total hard stop takes priority over a simultaneous daily hard stop breach (both FAILED, but total is checked first)", () => {
    const result = evaluateEvaluationAccount({ account: baseAccount({ dayStartEquity: 20000 }), currentEquity: 17000 }); // -15% total AND -15% daily
    expect(result.status).toBe("FAILED");
    expect(result.newlyFailedReason).toMatch(/TOTAL_HARD_STOP/);
  });
});

describe("MT5 Fase 2, spec section 11 — computeEvaluationDayKey (UTC, resetHourUtc-shifted)", () => {
  it("resetHourUtc=0 uses the plain UTC calendar day", () => {
    expect(computeEvaluationDayKey(new Date("2026-03-15T23:59:00Z"), 0)).toBe("2026-03-15");
    expect(computeEvaluationDayKey(new Date("2026-03-16T00:01:00Z"), 0)).toBe("2026-03-16");
  });

  it("a nonzero resetHourUtc shifts the day boundary — a moment just after UTC midnight can still be 'yesterday'", () => {
    // resetHourUtc = 5 means the trading day rolls over at 05:00 UTC, not 00:00 UTC.
    expect(computeEvaluationDayKey(new Date("2026-03-16T02:00:00Z"), 5)).toBe("2026-03-15");
    expect(computeEvaluationDayKey(new Date("2026-03-16T06:00:00Z"), 5)).toBe("2026-03-16");
  });
});
