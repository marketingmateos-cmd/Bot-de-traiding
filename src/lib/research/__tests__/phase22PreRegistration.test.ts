import { describe, expect, it } from "vitest";
import type { OHLCVBar } from "@/lib/providers/types";
import { FROZEN_RANGES, sliceAggregatedBarsToRange, splitAggregatedBars, TIMEFRAME_BAR_MS, FROZEN_DATASET_BTC_H4, FROZEN_DATASET_ETH_H4, FROZEN_DATASET_BTC_D1, FROZEN_DATASET_ETH_D1 } from "../phase22PreRegistration";
import { FROZEN_RANGES as F21_FROZEN_RANGES } from "../phase21PreRegistration";

function bar(iso: string): OHLCVBar {
  return { timestamp: new Date(iso), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

describe("Fase 22 reuses Fase 21's FROZEN_RANGES verbatim (never recomputes its own cutoffs)", () => {
  it("is the exact same object/values as phase21PreRegistration's FROZEN_RANGES", () => {
    expect(FROZEN_RANGES).toBe(F21_FROZEN_RANGES);
  });
});

describe("sliceAggregatedBarsToRange — a bar counts only if its FULL window (open..close) is inside the range", () => {
  it("keeps an H4 bar fully inside IS", () => {
    const b = bar("2025-03-14T00:00:00.000Z"); // window 00:00-03:59, well before IS.end=2025-03-14T09:00
    const result = sliceAggregatedBarsToRange([b], FROZEN_RANGES.is, "H4");
    expect(result).toHaveLength(1);
  });

  it("drops an H4 bar whose window straddles the IS/VALIDATION boundary (2025-03-14T09:00:00Z)", () => {
    const b = bar("2025-03-14T08:00:00.000Z"); // window 08:00-11:59:59.999 — crosses the 09:00 cutoff
    const inIs = sliceAggregatedBarsToRange([b], FROZEN_RANGES.is, "H4");
    const inValidation = sliceAggregatedBarsToRange([b], FROZEN_RANGES.validation, "H4");
    expect(inIs).toHaveLength(0);
    expect(inValidation).toHaveLength(0); // its open (08:00) is before VALIDATION.start (10:00) too — dropped from both, never force-assigned
  });

  it("drops a D1 bar whose window straddles the IS/VALIDATION boundary (the whole day of 2025-03-14)", () => {
    const b = bar("2025-03-14T00:00:00.000Z"); // window is the full day, 00:00 -> 23:59:59.999, crossing the 09:00 cutoff
    const inIs = sliceAggregatedBarsToRange([b], FROZEN_RANGES.is, "D1");
    const inValidation = sliceAggregatedBarsToRange([b], FROZEN_RANGES.validation, "D1");
    expect(inIs).toHaveLength(0);
    expect(inValidation).toHaveLength(0);
  });

  it("keeps a D1 bar fully inside VALIDATION", () => {
    const b = bar("2025-03-15T00:00:00.000Z"); // fully after IS.end, fully before OOS
    const result = sliceAggregatedBarsToRange([b], FROZEN_RANGES.validation, "D1");
    expect(result).toHaveLength(1);
  });

  it("TIMEFRAME_BAR_MS matches the real bar durations", () => {
    expect(TIMEFRAME_BAR_MS.H4).toBe(4 * 3_600_000);
    expect(TIMEFRAME_BAR_MS.D1).toBe(24 * 3_600_000);
  });
});

describe("splitAggregatedBars — counts always account for every input bar (kept in exactly one segment, or explicitly dropped)", () => {
  it("is/validation/oos counts plus droppedAtBoundaries sum to the total input length", () => {
    const bars: OHLCVBar[] = [];
    let t = new Date("2023-01-01T00:00:00.000Z").getTime();
    for (let i = 0; i < 400; i++) {
      bars.push(bar(new Date(t).toISOString()));
      t += TIMEFRAME_BAR_MS.D1;
    }
    const { counts } = splitAggregatedBars(bars, "D1");
    expect(counts.isCount + counts.validationCount + counts.oosCount + counts.droppedAtBoundaries).toBe(bars.length);
  });

  it("never double-counts a bar across segments (is/validation/oos are pairwise disjoint)", () => {
    const bars: OHLCVBar[] = [];
    let t = new Date("2023-01-01T00:00:00.000Z").getTime();
    for (let i = 0; i < 4000; i++) {
      bars.push(bar(new Date(t).toISOString()));
      t += TIMEFRAME_BAR_MS.H4;
    }
    const { is, validation, oos } = splitAggregatedBars(bars, "H4");
    const isSet = new Set(is.map((b) => b.timestamp.getTime()));
    const validationSet = new Set(validation.map((b) => b.timestamp.getTime()));
    const oosSet = new Set(oos.map((b) => b.timestamp.getTime()));
    for (const t2 of isSet) {
      expect(validationSet.has(t2)).toBe(false);
      expect(oosSet.has(t2)).toBe(false);
    }
    for (const t2 of validationSet) expect(oosSet.has(t2)).toBe(false);
  });
});

describe("frozen H4/D1 dataset identities — sanity (real values verified independently in Checkpoint 1)", () => {
  it("BTC and ETH H4/D1 share the same date range and coverage (same source H1 series, same gap)", () => {
    expect(FROZEN_DATASET_BTC_H4.startDate).toEqual(FROZEN_DATASET_ETH_H4.startDate);
    expect(FROZEN_DATASET_BTC_D1.gapCount).toBe(FROZEN_DATASET_ETH_D1.gapCount);
  });

  it("H4 and D1 datasets for the same symbol have different, non-empty hashes", () => {
    expect(FROZEN_DATASET_BTC_H4.datasetHash).not.toBe(FROZEN_DATASET_BTC_D1.datasetHash);
    expect(FROZEN_DATASET_BTC_H4.datasetHash.length).toBeGreaterThan(0);
  });
});
