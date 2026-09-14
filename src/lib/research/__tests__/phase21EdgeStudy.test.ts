import { describe, expect, it } from "vitest";
import { computeForwardReturns, computeTrailingReturns, computeForwardRealizedVol, computeTrailingPercentileRank, computeConditionalStats, blockBootstrapCI, bootstrapMeanCI, classifySignalEvidence } from "../phase21EdgeStudy";

describe("computeForwardReturns", () => {
  it("computes (future-base)/base at the correct offset", () => {
    const closes = [100, 105, 110, 121];
    const fwd = computeForwardReturns(closes, 2);
    expect(fwd[0]).toBeCloseTo((110 - 100) / 100, 10);
    expect(fwd[1]).toBeCloseTo((121 - 105) / 105, 10);
  });

  it("is null for the last `horizon` indices (nothing to look forward to)", () => {
    const closes = [100, 105, 110];
    const fwd = computeForwardReturns(closes, 2);
    expect(fwd[1]).toBeNull();
    expect(fwd[2]).toBeNull();
  });
});

describe("computeTrailingReturns", () => {
  it("computes (current-base)/base using only PAST prices ending at t", () => {
    const closes = [100, 105, 110, 121];
    const trailing = computeTrailingReturns(closes, 2);
    expect(trailing[2]).toBeCloseTo((110 - 100) / 100, 10);
    expect(trailing[3]).toBeCloseTo((121 - 105) / 105, 10);
  });

  it("is null before `horizon` bars of history exist", () => {
    const closes = [100, 105];
    const trailing = computeTrailingReturns(closes, 2);
    expect(trailing[0]).toBeNull();
    expect(trailing[1]).toBeNull();
  });
});

describe("computeTrailingPercentileRank", () => {
  it("never includes the current index's own value in its history window (mutating only index does not change its own rank input)", () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 5.5];
    const rankBase = computeTrailingPercentileRank(base, 10, 10);
    const mutated = [...base];
    mutated[10] = -999; // an extreme value at the index itself must never feed back into its OWN history window
    const rankMutated = computeTrailingPercentileRank(mutated, 10, 10);
    // The history window (indices 0-9) is identical in both cases — only rankBase/rankMutated's
    // OWN "current" value differs, which is expected to change the result, but the history it's
    // compared against (the denominator) must be the same 10 prior values in both cases.
    expect(rankBase).toBe(50);
    expect(rankMutated).toBe(0); // -999 ranks below all 10 prior values
  });

  it("returns null when fewer than half the lookback window has real data", () => {
    const values: (number | null)[] = [null, null, null, 1, 2];
    const rank = computeTrailingPercentileRank(values, 4, 10);
    expect(rank).toBeNull();
  });

  it("computes a mid-range percentile correctly", () => {
    const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const values = [...history, 5.5];
    const rank = computeTrailingPercentileRank(values, 10, 10);
    expect(rank).toBe(50); // 5 of 10 history values (1-5) are <= 5.5
  });
});

describe("computeForwardRealizedVol", () => {
  it("is null when the forward window doesn't fit entirely in the series", () => {
    const closes = [100, 101, 102];
    expect(computeForwardRealizedVol(closes, 1, 5)).toBeNull();
  });

  it("is 0 for a perfectly flat forward window", () => {
    const closes = [100, 100, 100, 100, 100];
    expect(computeForwardRealizedVol(closes, 0, 3)).toBeCloseTo(0, 10);
  });

  it("is positive for a genuinely varying forward window", () => {
    const closes = [100, 110, 95, 105, 100];
    const vol = computeForwardRealizedVol(closes, 0, 3);
    expect(vol).not.toBeNull();
    expect(vol as number).toBeGreaterThan(0);
  });
});

describe("computeConditionalStats", () => {
  it("computes n/mean/median/std/winRate correctly", () => {
    const stats = computeConditionalStats([0.1, -0.05, 0.2, -0.1]);
    expect(stats.n).toBe(4);
    expect(stats.mean).toBeCloseTo(0.0375, 10);
    expect(stats.winRate).toBe(0.5);
  });

  it("returns all-null stats for an empty sample, never NaN/0-by-default", () => {
    const stats = computeConditionalStats([]);
    expect(stats.n).toBe(0);
    expect(stats.mean).toBeNull();
    expect(stats.median).toBeNull();
    expect(stats.std).toBeNull();
    expect(stats.winRate).toBeNull();
  });
});

describe("blockBootstrapCI / bootstrapMeanCI", () => {
  const options = { iterations: 300, seed: 21, blockSize: 5 };

  it("is fully deterministic for a fixed seed", () => {
    const values = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) * 0.02);
    const a = bootstrapMeanCI(values, options);
    const b = bootstrapMeanCI(values, options);
    expect(a).toEqual(b);
  });

  it("returns a null CI (not a crash) when the series is too short for the block size", () => {
    const result = bootstrapMeanCI([0.01, -0.01], options);
    expect(result.ciLow).toBeNull();
    expect(result.bootstrapSamples).toBe(0);
  });

  it("ciLow <= ciHigh always holds", () => {
    const values = Array.from({ length: 50 }, (_, i) => (i % 3 === 0 ? 0.05 : -0.01));
    const result = bootstrapMeanCI(values, options);
    expect(result.ciLow).not.toBeNull();
    expect((result.ciLow as number) <= (result.ciHigh as number)).toBe(true);
  });
});

describe("classifySignalEvidence", () => {
  const minSampleSize = 20;

  it("returns INSUFFICIENT_SAMPLE below minSampleSize", () => {
    const stats = computeConditionalStats([0.1, 0.2]);
    const ci = { observed: 0.15, ciLow: 0.1, ciHigh: 0.2, bootstrapSamples: 100 };
    expect(classifySignalEvidence(stats, ci, 1, minSampleSize)).toBe("INSUFFICIENT_SAMPLE");
  });

  it("returns NO_SIGNAL when the CI straddles zero", () => {
    const stats = computeConditionalStats(new Array(30).fill(0.01));
    const ci = { observed: 0.01, ciLow: -0.01, ciHigh: 0.03, bootstrapSamples: 100 };
    expect(classifySignalEvidence(stats, ci, 1, minSampleSize)).toBe("NO_SIGNAL");
  });

  it("returns SIGNIFICANT_CONTINUATION when the CI is positive and expected sign is +1 (extreme-high bucket keeps rising)", () => {
    const stats = computeConditionalStats(new Array(30).fill(0.02));
    const ci = { observed: 0.02, ciLow: 0.01, ciHigh: 0.03, bootstrapSamples: 100 };
    expect(classifySignalEvidence(stats, ci, 1, minSampleSize)).toBe("SIGNIFICANT_CONTINUATION");
  });

  it("returns SIGNIFICANT_REVERSAL when the CI is negative but expected sign is +1 (extreme-high bucket reverts down)", () => {
    const stats = computeConditionalStats(new Array(30).fill(-0.02));
    const ci = { observed: -0.02, ciLow: -0.03, ciHigh: -0.01, bootstrapSamples: 100 };
    expect(classifySignalEvidence(stats, ci, 1, minSampleSize)).toBe("SIGNIFICANT_REVERSAL");
  });

  it("returns SIGNIFICANT_CONTINUATION when the CI is negative and expected sign is -1 (extreme-low bucket keeps falling)", () => {
    const stats = computeConditionalStats(new Array(30).fill(-0.02));
    const ci = { observed: -0.02, ciLow: -0.03, ciHigh: -0.01, bootstrapSamples: 100 };
    expect(classifySignalEvidence(stats, ci, -1, minSampleSize)).toBe("SIGNIFICANT_CONTINUATION");
  });
});
