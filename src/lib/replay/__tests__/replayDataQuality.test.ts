import { describe, expect, it } from "vitest";
import { evaluateHistoricalDataQuality } from "../replayDataQuality";
import type { OHLCVBar } from "@/lib/providers/types";

const HOUR = 60 * 60_000;

function makeBar(t: number, overrides: Partial<OHLCVBar> = {}): OHLCVBar {
  return { timestamp: new Date(t), open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides };
}

describe("AUDIT: Historical Data Quality Report (Fase 7C)", () => {
  it("reports full coverage, zero issues on a clean, gap-free, chronological series", () => {
    const start = 0;
    const end = 9 * HOUR;
    const bars = Array.from({ length: 10 }, (_, i) => makeBar(start + i * HOUR));
    const report = evaluateHistoricalDataQuality(bars, "H1", new Date(start), new Date(end));

    expect(report.coveragePct).toBeCloseTo(100, 5);
    expect(report.missingCandlesPct).toBe(0);
    expect(report.duplicateTimestamps).toBe(0);
    expect(report.invalidCandles).toBe(0);
    expect(report.futureLeakage).toBe(0);
    expect(report.chronologyViolations).toBe(0);
    expect(report.blocksReplay).toBe(false);
  });

  it("detects duplicate timestamps", () => {
    const bars = [makeBar(0), makeBar(HOUR), makeBar(HOUR), makeBar(2 * HOUR)];
    const report = evaluateHistoricalDataQuality(bars, "H1", new Date(0), new Date(2 * HOUR));
    expect(report.duplicateTimestamps).toBe(1);
  });

  it("detects gaps and reports the missing-candle percentage", () => {
    // 10 expected hourly candles, but bar at hour 5 is missing entirely.
    const bars = [0, 1, 2, 3, 4, 6, 7, 8, 9].map((h) => makeBar(h * HOUR));
    const report = evaluateHistoricalDataQuality(bars, "H1", new Date(0), new Date(9 * HOUR));
    expect(report.missingCandlesPct).toBeGreaterThan(0);
    expect(report.totalBarsPresent).toBe(9);
    expect(report.totalBarsExpected).toBe(10);
  });

  it("detects out-of-chronological-order timestamps and blocks the replay", () => {
    const bars = [makeBar(0), makeBar(2 * HOUR), makeBar(HOUR)]; // out of order
    const report = evaluateHistoricalDataQuality(bars, "H1", new Date(0), new Date(2 * HOUR));
    expect(report.chronologyViolations).toBeGreaterThan(0);
    expect(report.blocksReplay).toBe(true);
  });

  it("detects impossible OHLCV candles (high below low, negative price)", () => {
    const bars = [makeBar(0), makeBar(HOUR, { high: 90, low: 99 }), makeBar(2 * HOUR, { close: -5 })];
    const report = evaluateHistoricalDataQuality(bars, "H1", new Date(0), new Date(2 * HOUR));
    expect(report.invalidCandles).toBe(2);
  });

  it("detects future leakage: a bar timestamped after the requested range's end", () => {
    const bars = [makeBar(0), makeBar(HOUR), makeBar(5 * HOUR)]; // 5*HOUR is past rangeEnd=2*HOUR
    const report = evaluateHistoricalDataQuality(bars, "H1", new Date(0), new Date(2 * HOUR));
    expect(report.futureLeakage).toBeGreaterThan(0);
    expect(report.blocksReplay).toBe(true);
  });

  it("blocks the replay outright when there are zero bars for the requested range", () => {
    const report = evaluateHistoricalDataQuality([], "H1", new Date(0), new Date(HOUR));
    expect(report.blocksReplay).toBe(true);
    expect(report.coveragePct).toBe(0);
  });

  it("blocks when coverage falls below the minimum reliable threshold", () => {
    // Only 2 of 20 expected hourly candles present.
    const bars = [makeBar(0), makeBar(HOUR)];
    const report = evaluateHistoricalDataQuality(bars, "H1", new Date(0), new Date(19 * HOUR));
    expect(report.coveragePct).toBeLessThan(50);
    expect(report.blocksReplay).toBe(true);
  });
});
