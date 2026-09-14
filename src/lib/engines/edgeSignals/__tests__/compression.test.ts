import { describe, expect, it } from "vitest";
import type { OHLCVBar } from "@/lib/providers/types";
import { computeAtrPercentileRanks, computeCoilLength } from "../compression";

function makeBars(closes: number[], rangeSize = 1): OHLCVBar[] {
  return closes.map((c, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, i)),
    open: c,
    high: c + rangeSize,
    low: c - rangeSize,
    close: c,
    volume: 100,
  }));
}

describe("computeAtrPercentileRanks", () => {
  it("returns null for bars without enough trailing history", () => {
    const bars = makeBars(new Array(10).fill(100));
    const ranks = computeAtrPercentileRanks(bars, 14, 40);
    expect(ranks.every((r) => r === null)).toBe(true);
  });

  it("is causal: the rank at index i never changes when a bar strictly AFTER i is mutated to an extreme value", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 2);
    const baseBars = makeBars(closes, 1);
    const mutatedBars = makeBars(closes, 1);
    // Mutate a bar far in the future (index 70) to have an extreme range.
    mutatedBars[70] = { ...mutatedBars[70], high: mutatedBars[70].high + 500, low: mutatedBars[70].low - 500 };

    const baseRanks = computeAtrPercentileRanks(baseBars, 14, 40);
    const mutatedRanks = computeAtrPercentileRanks(mutatedBars, 14, 40);

    // Every rank strictly before index 70 must be unaffected by the mutation at 70.
    for (let i = 0; i < 70; i++) {
      expect(mutatedRanks[i]).toEqual(baseRanks[i]);
    }
  });

  it("assigns a low percentile rank to a bar whose ATR is the smallest in its trailing window", () => {
    // Build a series with volatile bars, then a run of very tight bars.
    const volatileCloses = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 20);
    const tightCloses = new Array(10).fill(100);
    const closes = [...volatileCloses, ...tightCloses];
    const bars = closes.map((c, i) => {
      const isTight = i >= volatileCloses.length;
      const rangeSize = isTight ? 0.05 : 3;
      return { timestamp: new Date(Date.UTC(2026, 0, 1, i)), open: c, high: c + rangeSize, low: c - rangeSize, close: c, volume: 100 };
    });
    const ranks = computeAtrPercentileRanks(bars, 14, 40);
    const lastRank = ranks[ranks.length - 1];
    expect(lastRank).not.toBeNull();
    expect(lastRank as number).toBeLessThan(20);
  });
});

describe("computeCoilLength", () => {
  it("returns 0 when the bar at index is not itself compressed", () => {
    const ranks = [10, 15, 80, null];
    expect(computeCoilLength(ranks, 2, 20)).toBe(0);
  });

  it("counts consecutive compressed bars ending at index, stopping at the first non-compressed or null bar", () => {
    const ranks = [90, 10, 15, 5, 18, 12];
    expect(computeCoilLength(ranks, 5, 20)).toBe(5); // indices 1..5 are all <= 20
  });

  it("is causal: never looks forward past index", () => {
    const ranks = [10, 10, 10, 90, 10, 10];
    // index 2's coil length must ignore index 3 (90) and everything after it.
    expect(computeCoilLength(ranks, 2, 20)).toBe(3);
  });
});
