import { describe, expect, it } from "vitest";
import { runFamilyADiscovery, runFamilyASegment, computeWalkForwardWindowBoundaries, runFamilyAWalkForward, sliceBarsToRange, sliceIsBars } from "../phase20FamilyA";
import { FROZEN_RANGES } from "../phase20PreRegistration";
import { DiscoveryContaminationError } from "../phase20Discovery";
import type { OHLCVBar } from "@/lib/providers/types";

const STEP_MS = 3_600_000;

function makeBars(startMs: number, count: number): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 4) * 3;
    return { timestamp: new Date(startMs + i * STEP_MS), open: close, high: close + 0.5, low: close - 0.5, close, volume: 1000 };
  });
}

describe("runFamilyADiscovery — structural IS-only barrier", () => {
  it("computes ACF for all 6 frozen lags on genuine IS-only bars", () => {
    const bars = makeBars(FROZEN_RANGES.is.start.getTime(), 200);
    const results = runFamilyADiscovery(bars);
    expect(results).toHaveLength(6);
    expect(results.map((r) => r.lag)).toEqual([1, 2, 3, 6, 12, 24]);
  });

  it("throws DiscoveryContaminationError when handed bars that cross into VALIDATION territory", () => {
    const bars = makeBars(FROZEN_RANGES.validation.start.getTime() - 5 * STEP_MS, 20);
    expect(() => runFamilyADiscovery(bars)).toThrow(DiscoveryContaminationError);
  });
});

describe("runFamilyASegment — plain bars, no IS-only restriction", () => {
  it("computes ACF for VALIDATION-range bars without throwing", () => {
    const bars = makeBars(FROZEN_RANGES.validation.start.getTime(), 200);
    const results = runFamilyASegment(bars);
    expect(results).toHaveLength(6);
  });
});

describe("computeWalkForwardWindowBoundaries", () => {
  it("produces windows whose trainEnd is between windowStart and windowEnd, using the given trainFraction", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-06-01T00:00:00.000Z");
    const windows = computeWalkForwardWindowBoundaries(start, end, { windowSizeDays: 90, trainFraction: 0.7, stepDays: 45 });
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.trainEnd).toBeGreaterThan(w.windowStart);
      expect(w.trainEnd).toBeLessThan(w.windowEnd);
    }
  });

  it("produces no windows when the range is shorter than windowSizeDays", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-10T00:00:00.000Z");
    const windows = computeWalkForwardWindowBoundaries(start, end, { windowSizeDays: 90, trainFraction: 0.7, stepDays: 45 });
    expect(windows).toHaveLength(0);
  });
});

describe("runFamilyAWalkForward — sign stability", () => {
  it("returns one entry per frozen lag with a fraction between 0 and 1", () => {
    const start = FROZEN_RANGES.is.start;
    const bars = makeBars(start.getTime(), 24 * 200); // ~200 days of hourly bars, enough for a couple of 90-day windows
    const end = new Date(start.getTime() + 24 * 200 * STEP_MS);
    const results = runFamilyAWalkForward(bars, { start, end });
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.sameSignFraction).toBeGreaterThanOrEqual(0);
      expect(r.sameSignFraction).toBeLessThanOrEqual(1);
    }
  });
});

describe("sliceBarsToRange / sliceIsBars", () => {
  it("slices to exactly the bars within [start, end] inclusive", () => {
    const bars = makeBars(Date.UTC(2026, 0, 1), 10);
    const range = { start: bars[2].timestamp, end: bars[5].timestamp };
    const sliced = sliceBarsToRange(bars, range);
    expect(sliced).toHaveLength(4);
    expect(sliced[0].timestamp).toEqual(bars[2].timestamp);
    expect(sliced[sliced.length - 1].timestamp).toEqual(bars[5].timestamp);
  });

  it("sliceIsBars only returns bars within FROZEN_RANGES.is", () => {
    const bars = makeBars(FROZEN_RANGES.is.start.getTime() - 10 * STEP_MS, 40);
    const sliced = sliceIsBars(bars);
    for (const b of sliced) {
      expect(b.timestamp.getTime()).toBeGreaterThanOrEqual(FROZEN_RANGES.is.start.getTime());
      expect(b.timestamp.getTime()).toBeLessThanOrEqual(FROZEN_RANGES.is.end.getTime());
    }
  });
});
