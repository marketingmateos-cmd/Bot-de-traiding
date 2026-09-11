import { describe, expect, it } from "vitest";
import { evaluateDataQuality, MIN_SCORE_TO_TRADE } from "../dataQuality";
import type { OHLCVBar } from "@/lib/providers/types";

function bar(overrides: Partial<OHLCVBar> & { timestamp: Date }): OHLCVBar {
  return { open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides };
}

function cleanSeries(count: number, stepMs = 3_600_000): OHLCVBar[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => bar({ timestamp: new Date(now - (count - i) * stepMs) }));
}

describe("evaluateDataQuality", () => {
  it("scores a perfectly clean series at 100 with no issues", () => {
    const report = evaluateDataQuality(cleanSeries(30), "H1");
    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
    expect(report.blocksTrading).toBe(false);
  });

  it("returns score 0 and blocks trading for an empty series", () => {
    const report = evaluateDataQuality([], "H1");
    expect(report.score).toBe(0);
    expect(report.blocksTrading).toBe(true);
  });

  it("penalizes duplicate timestamps", () => {
    const bars = cleanSeries(10);
    bars[5] = { ...bars[5], timestamp: bars[4].timestamp };
    const report = evaluateDataQuality(bars, "H1");
    expect(report.issues.some((i) => i.type === "DUPLICATE_TIMESTAMP")).toBe(true);
    expect(report.score).toBeLessThan(100);
  });

  it("penalizes out-of-order timestamps", () => {
    const bars = cleanSeries(10);
    const swapped = [...bars];
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    const report = evaluateDataQuality(swapped, "H1");
    expect(report.issues.some((i) => i.type === "BAD_TIMESTAMP_ORDER")).toBe(true);
  });

  it("penalizes an impossible OHLC relationship (high below open/close)", () => {
    const bars = cleanSeries(10);
    bars[5] = { ...bars[5], open: 100, close: 105, high: 102, low: 99 }; // high < close
    const report = evaluateDataQuality(bars, "H1");
    expect(report.issues.some((i) => i.type === "IMPOSSIBLE_PRICE")).toBe(true);
  });

  it("penalizes missing bars (a gap larger than one step)", () => {
    const bars = cleanSeries(10);
    bars.splice(5, 1); // remove one bar, creating a 2x gap
    const report = evaluateDataQuality(bars, "H1");
    expect(report.issues.some((i) => i.type === "MISSING_BARS")).toBe(true);
  });

  it("blocks trading once the score drops below the minimum threshold", () => {
    const bars = cleanSeries(10);
    // Corrupt several bars badly enough to push the score under the floor.
    for (let i = 0; i < 5; i++) {
      bars[i] = { ...bars[i], high: 50, low: 200, open: 100, close: 100 };
    }
    const report = evaluateDataQuality(bars, "H1");
    expect(report.score).toBeLessThan(MIN_SCORE_TO_TRADE);
    expect(report.blocksTrading).toBe(true);
  });
});
