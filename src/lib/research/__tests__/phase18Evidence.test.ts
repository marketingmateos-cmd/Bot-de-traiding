import { describe, expect, it } from "vitest";
import { classifyStrategyEvidence, computeStabilityDiagnostics, type SegmentSummary } from "../phase18Evidence";

function seg(overrides: Partial<SegmentSummary> = {}): SegmentSummary {
  return { trades: 30, returnPct: 1, profitFactor: 1.2, avgR: 0.1, maxDrawdownPct: 3, expectancy: 5, longCount: 15, shortCount: 15, ...overrides };
}

describe("computeStabilityDiagnostics", () => {
  it("computes signs, PF>1 flags, and relative changes correctly", () => {
    const is = seg({ returnPct: 5, profitFactor: 1.5, avgR: 0.2, expectancy: 10 });
    const validation = seg({ returnPct: -2, profitFactor: 0.8, avgR: -0.1, expectancy: -3 });
    const oos = seg({ returnPct: 0, profitFactor: null, avgR: null, expectancy: 0 });
    const diag = computeStabilityDiagnostics(is, validation, oos);
    expect(diag.returnSigns).toEqual({ is: 1, validation: -1, oos: 0 });
    expect(diag.expectancySigns).toEqual({ is: 1, validation: -1, oos: 0 });
    expect(diag.pfAboveOne).toEqual({ is: true, validation: false, oos: null });
    expect(diag.pfRelativeChange.validationVsIs).toBeCloseTo((0.8 - 1.5) / 1.5, 6);
    expect(diag.pfRelativeChange.oosVsIs).toBeNull(); // oos.profitFactor is null
    expect(diag.avgRRelativeChange.validationVsIs).toBeCloseTo((-0.1 - 0.2) / 0.2, 6);
    expect(diag.degradedIsToValidation).toBe(true); // IS>0, validation<=0
    expect(diag.degradedIsToOos).toBe(true); // IS>0, oos<=0
  });

  it("flags long/short consistency only when a dominant direction exists in every segment with trades and they all agree", () => {
    const longDominant = seg({ longCount: 20, shortCount: 5 });
    const diagConsistent = computeStabilityDiagnostics(longDominant, longDominant, longDominant);
    expect(diagConsistent.longShortConsistent).toBe(true);

    const shortDominant = seg({ longCount: 5, shortCount: 20 });
    const diagInconsistent = computeStabilityDiagnostics(longDominant, shortDominant, longDominant);
    expect(diagInconsistent.longShortConsistent).toBe(false);
  });

  it("never fabricates a dominant direction when long/short counts are tied", () => {
    const balanced = seg({ longCount: 10, shortCount: 10 });
    const diag = computeStabilityDiagnostics(balanced, balanced, balanced);
    expect(diag.longShortConsistent).toBe(true); // no direction anywhere -> vacuously consistent, never forced
  });
});

describe("classifyStrategyEvidence — spec sections 8/9/12/25", () => {
  it("NEGATIVE when all 3 segments are unfavorable, regardless of OOS sample size", () => {
    const bad = seg({ returnPct: -3, trades: 5 }); // deliberately small n — NEGATIVE is not sample-gated the same way positive claims are
    const result = classifyStrategyEvidence(bad, bad, bad, { windowCount: 0, positiveWindowFraction: 0 });
    expect(result.status).toBe("NEGATIVE");
  });

  it("INCONCLUSIVE when OOS sample is below MIN_SAMPLE_SIZE and results aren't uniformly negative", () => {
    const is = seg({ returnPct: 2 });
    const validation = seg({ returnPct: 1 });
    const oos = seg({ returnPct: 1, trades: 8 }); // n < 20
    const result = classifyStrategyEvidence(is, validation, oos, { windowCount: 0, positiveWindowFraction: 0 });
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.oosSampleAdequate).toBe(false);
  });

  it("SUPPORTED only when IS+Validation+OOS are all favorable, OOS sample is adequate, AND the majority of walk-forward windows are positive", () => {
    const favorable = seg({ returnPct: 3, trades: 25 });
    const result = classifyStrategyEvidence(favorable, favorable, favorable, { windowCount: 3, positiveWindowFraction: 2 / 3 });
    expect(result.status).toBe("SUPPORTED");
  });

  it("WEAK_SUPPORT when IS+Validation+OOS are all favorable but walk-forward doesn't confirm (or is unavailable)", () => {
    const favorable = seg({ returnPct: 3, trades: 25 });
    const noWf = classifyStrategyEvidence(favorable, favorable, favorable, { windowCount: 0, positiveWindowFraction: 0 });
    expect(noWf.status).toBe("WEAK_SUPPORT");

    const minorityWf = classifyStrategyEvidence(favorable, favorable, favorable, { windowCount: 3, positiveWindowFraction: 1 / 3 });
    expect(minorityWf.status).toBe("WEAK_SUPPORT");
  });

  it("REJECTED when IS (or Validation) was favorable but OOS clearly contradicts it with adequate sample", () => {
    const is = seg({ returnPct: 5, trades: 40 });
    const validation = seg({ returnPct: -1, trades: 30 });
    const oos = seg({ returnPct: -4, trades: 25 });
    const result = classifyStrategyEvidence(is, validation, oos, { windowCount: 2, positiveWindowFraction: 0 });
    expect(result.status).toBe("REJECTED");
  });

  it("never forces a category — mixed/contradictory results with adequate sample and no clean pattern land in INCONCLUSIVE", () => {
    // IS unfavorable, Validation favorable, OOS unfavorable: not uniformly negative, not degraded-from-IS (IS wasn't favorable), not 2/3 favorable-with-OOS-favorable.
    const is = seg({ returnPct: -1, trades: 25 });
    const validation = seg({ returnPct: 2, trades: 25 });
    const oos = seg({ returnPct: -1, trades: 25 });
    const result = classifyStrategyEvidence(is, validation, oos, { windowCount: 0, positiveWindowFraction: 0 });
    expect(result.status).toBe("INCONCLUSIVE");
  });

  it("is deterministic — the exact same inputs always produce the exact same classification", () => {
    const is = seg({ returnPct: 5, trades: 40 });
    const validation = seg({ returnPct: -1, trades: 30 });
    const oos = seg({ returnPct: -4, trades: 25 });
    const wf = { windowCount: 2, positiveWindowFraction: 0 };
    expect(classifyStrategyEvidence(is, validation, oos, wf)).toEqual(classifyStrategyEvidence(is, validation, oos, wf));
  });
});
