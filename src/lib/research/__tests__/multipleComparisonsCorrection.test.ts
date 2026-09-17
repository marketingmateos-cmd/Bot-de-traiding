import { describe, expect, it } from "vitest";
import { applyBenjaminiHochbergFDR, applyBonferroniCorrection, summarizeCorrection, type PValueResult } from "../multipleComparisonsCorrection";

// Textbook-style batch: p-values chosen so Bonferroni and BH-FDR visibly
// disagree — this is the whole point of reporting both (spec: never pick
// whichever method is more favorable after seeing the p-values).
const TEN_TESTS: PValueResult[] = [
  { id: "t1", pValue: 0.01 },
  { id: "t2", pValue: 0.02 },
  { id: "t3", pValue: 0.03 },
  { id: "t4", pValue: 0.04 },
  { id: "t5", pValue: 0.05 },
  { id: "t6", pValue: 0.06 },
  { id: "t7", pValue: 0.2 },
  { id: "t8", pValue: 0.5 },
  { id: "t9", pValue: 0.8 },
  { id: "t10", pValue: 0.99 },
];

describe("applyBonferroniCorrection", () => {
  it("familywise alpha 0.05 over 10 tests -> per-test threshold 0.005; none of the 10 curated p-values survive", () => {
    const corrected = applyBonferroniCorrection(TEN_TESTS, 0.05);
    expect(corrected).toHaveLength(10);
    expect(corrected.every((r) => r.threshold === 0.005)).toBe(true);
    expect(corrected.filter((r) => r.significant)).toHaveLength(0);
  });

  it("a p-value at or below the threshold is significant; one just above is not — boundary is inclusive", () => {
    const results: PValueResult[] = [{ id: "at", pValue: 0.005 }, { id: "above", pValue: 0.0050001 }];
    const corrected = applyBonferroniCorrection(results, 0.01); // threshold = 0.01/2 = 0.005
    expect(corrected.find((r) => r.id === "at")?.significant).toBe(true);
    expect(corrected.find((r) => r.id === "above")?.significant).toBe(false);
  });

  it("assigns 1-based rank by ascending p-value", () => {
    const corrected = applyBonferroniCorrection(TEN_TESTS, 0.05);
    const byId = Object.fromEntries(corrected.map((r) => [r.id, r.rank]));
    expect(byId.t1).toBe(1);
    expect(byId.t10).toBe(10);
  });

  it("empty batch returns empty result, never throws", () => {
    expect(applyBonferroniCorrection([], 0.05)).toEqual([]);
  });

  it("rejects an invalid familywiseAlpha (<=0 or >1)", () => {
    expect(() => applyBonferroniCorrection(TEN_TESTS, 0)).toThrow();
    expect(() => applyBonferroniCorrection(TEN_TESTS, 1.5)).toThrow();
  });

  it("rejects a p-value outside [0,1] and a duplicate id within the same batch", () => {
    expect(() => applyBonferroniCorrection([{ id: "bad", pValue: 1.5 }], 0.05)).toThrow();
    expect(() => applyBonferroniCorrection([{ id: "dup", pValue: 0.1 }, { id: "dup", pValue: 0.2 }], 0.05)).toThrow();
  });

  it("never mutates the input array", () => {
    const original = [...TEN_TESTS];
    applyBonferroniCorrection(TEN_TESTS, 0.05);
    expect(TEN_TESTS).toEqual(original);
  });

  it("deterministic — same input always produces the same output", () => {
    const a = applyBonferroniCorrection(TEN_TESTS, 0.05);
    const b = applyBonferroniCorrection(TEN_TESTS, 0.05);
    expect(a).toEqual(b);
  });
});

describe("applyBenjaminiHochbergFDR", () => {
  it("the classic step-up example: with q=0.10 over the 10 curated p-values, exactly the 6 smallest are declared significant (BH is less conservative than Bonferroni on the SAME batch)", () => {
    const corrected = applyBenjaminiHochbergFDR(TEN_TESTS, 0.1);
    const significantIds = corrected.filter((r) => r.significant).map((r) => r.id).sort();
    expect(significantIds).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
  });

  it("step-up procedure: a result that FAILS its own per-rank threshold is still declared significant when a later (higher) rank passes its own threshold (step-up, not a per-result independent check)", () => {
    // m=3, q=0.3 -> thresholds: rank1=0.1, rank2=0.2, rank3=0.3.
    // r2=0.25 individually FAILS its rank-2 threshold (0.25 > 0.2), but
    // r3=0.29 passes its rank-3 threshold (0.29 <= 0.3), so the largest
    // significant rank is 3 and every rank <= 3 — including r2 — is pulled in.
    const results: PValueResult[] = [
      { id: "r1", pValue: 0.001 },
      { id: "r2", pValue: 0.25 },
      { id: "r3", pValue: 0.29 },
    ];
    const corrected = applyBenjaminiHochbergFDR(results, 0.3);
    expect(corrected.find((r) => r.id === "r2")?.pValue).toBeGreaterThan(corrected.find((r) => r.id === "r2")!.threshold);
    expect(corrected.filter((r) => r.significant).map((r) => r.id).sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("no result survives when even the smallest p-value exceeds its own rank-1 threshold", () => {
    const results: PValueResult[] = [{ id: "a", pValue: 0.5 }, { id: "b", pValue: 0.6 }];
    const corrected = applyBenjaminiHochbergFDR(results, 0.05);
    expect(corrected.every((r) => !r.significant)).toBe(true);
  });

  it("empty batch returns empty result, never throws", () => {
    expect(applyBenjaminiHochbergFDR([], 0.1)).toEqual([]);
  });

  it("rejects an invalid fdrQ (<=0 or >1)", () => {
    expect(() => applyBenjaminiHochbergFDR(TEN_TESTS, 0)).toThrow();
    expect(() => applyBenjaminiHochbergFDR(TEN_TESTS, 2)).toThrow();
  });

  it("deterministic and non-mutating", () => {
    const original = [...TEN_TESTS];
    const a = applyBenjaminiHochbergFDR(TEN_TESTS, 0.1);
    const b = applyBenjaminiHochbergFDR(TEN_TESTS, 0.1);
    expect(a).toEqual(b);
    expect(TEN_TESTS).toEqual(original);
  });
});

describe("summarizeCorrection", () => {
  it("counts totals and lists significant ids, matching applyBenjaminiHochbergFDR's own verdicts", () => {
    const corrected = applyBenjaminiHochbergFDR(TEN_TESTS, 0.1);
    const summary = summarizeCorrection(corrected);
    expect(summary.totalTests).toBe(10);
    expect(summary.significantCount).toBe(6);
    expect(summary.significantIds.sort()).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
  });

  it("zero significant when the batch is empty", () => {
    expect(summarizeCorrection([])).toEqual({ totalTests: 0, significantCount: 0, significantIds: [] });
  });
});
