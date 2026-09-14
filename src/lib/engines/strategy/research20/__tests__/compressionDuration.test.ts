import { describe, expect, it } from "vitest";
import { compressionDurationStrategy } from "../compressionDuration";
import type { OHLCVBar } from "@/lib/providers/types";
import type { FeatureSnapshot } from "@/lib/engines/features";

const DUMMY_FEATURES: FeatureSnapshot = {
  close: 100,
  sma20: null,
  sma50: null,
  ema20: null,
  rsi14: null,
  macdHistogram: null,
  atr14: null,
  bbUpper: null,
  bbLower: null,
  volatility20: null,
  volumeZScore20: null,
  trend: 0,
  momentum: 0,
};

function rangeBar(rangeHalf: number, timestamp: Date): OHLCVBar {
  return { timestamp, open: 100, high: 100 + rangeHalf, low: 100 - rangeHalf, close: 100, volume: 1000 };
}

const STEP_MS = 3_600_000;

/**
 * 60 "normal" bars followed by `coilBars` tightly-compressed bars — enough
 * for `minCoilLength`(10) consecutive compressed bars to exist immediately
 * before whatever "current" bar the caller appends.
 */
function buildCoiledSetup(coilBars = 15): OHLCVBar[] {
  const now = Date.now();
  const total = 60 + coilBars;
  return Array.from({ length: total }, (_, i) => {
    const timestamp = new Date(now - (total + 1 - i) * STEP_MS);
    const rangeHalf = i < 60 ? 0.75 + (i % 5) * 0.15 : 0.05;
    return rangeBar(rangeHalf, timestamp);
  });
}

/** Only `shortCoilBars`(< minCoilLength) compressed bars before the current one — a squeeze exists but hasn't lasted long enough. */
function buildShortCoilSetup(shortCoilBars = 4) {
  return buildCoiledSetup(shortCoilBars);
}

function currentBar(direction: "LONG" | "SHORT", timestamp: Date): OHLCVBar {
  return direction === "LONG"
    ? { timestamp, open: 100, high: 112, low: 100, close: 110, volume: 1000 }
    : { timestamp, open: 100, high: 100, low: 88, close: 90, volume: 1000 };
}

function evaluate(bars: OHLCVBar[]) {
  return compressionDurationStrategy.evaluate(bars, DUMMY_FEATURES, compressionDurationStrategy.defaultParams, "NEUTRAL");
}

describe("CompressionDurationStrategy — correct signal", () => {
  it("fires LONG on a real expansion breaking above the range, after >= minCoilLength consecutive compressed bars", () => {
    const setup = buildCoiledSetup();
    const now = Date.now();
    const result = evaluate([...setup, currentBar("LONG", new Date(now - STEP_MS))]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect((result?.meta?.coilLength as number) ?? 0).toBeGreaterThanOrEqual(10);
  });

  it("fires SHORT on a real expansion breaking below the range, after >= minCoilLength consecutive compressed bars", () => {
    const setup = buildCoiledSetup();
    const now = Date.now();
    const result = evaluate([...setup, currentBar("SHORT", new Date(now - STEP_MS))]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
  });
});

describe("CompressionDurationStrategy — no signal without a long-enough compression", () => {
  it("stays flat on the same breakout bar when the compression lasted fewer than minCoilLength bars", () => {
    const setup = buildShortCoilSetup();
    const now = Date.now();
    const result = evaluate([...setup, currentBar("LONG", new Date(now - STEP_MS))]);
    expect(result).toBeNull();
  });

  it("stays flat during the compression itself, before any expansion happens", () => {
    const setup = buildCoiledSetup();
    expect(evaluate(setup)).toBeNull();
  });
});

describe("CompressionDurationStrategy — no lookahead", () => {
  it("a future breakout bar has no effect until it legitimately becomes the current bar", () => {
    const setup = buildCoiledSetup();
    const now = Date.now();
    expect(evaluate(setup)).toBeNull();
    const future = currentBar("LONG", new Date(now + STEP_MS));
    const result = evaluate([...setup, future]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });
});

describe("CompressionDurationStrategy — insufficient history", () => {
  it("returns null with fewer than squeezeLookback+rangeLookback+atrPeriod+minCoilLength+2 bars", () => {
    const tooFew = buildCoiledSetup().slice(-40);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("CompressionDurationStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const setup = buildCoiledSetup();
    const now = Date.now();
    const bars = [...setup, currentBar("LONG", new Date(now - STEP_MS))];
    expect(evaluate(bars)).toEqual(evaluate(bars));
  });
});
