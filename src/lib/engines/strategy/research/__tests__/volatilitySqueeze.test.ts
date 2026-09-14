import { describe, expect, it } from "vitest";
import { volatilitySqueezeStrategy } from "../volatilitySqueeze";
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

// Flat close (prevClose diffs = 0) so true range == high-low exactly, keeping
// the ATR math predictable and easy to reason about in a test fixture.
function rangeBar(rangeHalf: number, timestamp: Date): OHLCVBar {
  return { timestamp, open: 100, high: 100 + rangeHalf, low: 100 - rangeHalf, close: 100, volume: 1000 };
}

const STEP_MS = 3_600_000;

/** 60 "normal" bars (varied, moderate range) followed by 10 tightly-compressed "squeeze" bars — exactly `rangeLookback`(10) of them, immediately before whatever bar gets appended as "current". */
function buildSqueezeSetup(): OHLCVBar[] {
  const now = Date.now();
  const total = 70;
  return Array.from({ length: total }, (_, i) => {
    const timestamp = new Date(now - (total + 1 - i) * STEP_MS);
    const rangeHalf = i < 60 ? 0.75 + (i % 5) * 0.15 : 0.05;
    return rangeBar(rangeHalf, timestamp);
  });
}

/** Same length, but NO compression at the end — every bar has the same moderate range, so there is nothing for the squeeze percentile check to detect. */
function buildNoSqueezeSetup(): OHLCVBar[] {
  const now = Date.now();
  const total = 70;
  return Array.from({ length: total }, (_, i) => rangeBar(1.0, new Date(now - (total + 1 - i) * STEP_MS)));
}

function currentBar(direction: "LONG" | "SHORT", timestamp: Date): OHLCVBar {
  return direction === "LONG"
    ? { timestamp, open: 100, high: 112, low: 100, close: 110, volume: 1000 } // big real expansion, closes well above the squeeze range
    : { timestamp, open: 100, high: 100, low: 88, close: 90, volume: 1000 };
}

function evaluate(bars: OHLCVBar[]) {
  return volatilitySqueezeStrategy.evaluate(bars, DUMMY_FEATURES, volatilitySqueezeStrategy.defaultParams, "NEUTRAL");
}

describe("VolatilitySqueezeStrategy — correct signal", () => {
  it("fires LONG on a real expansion breaking above the compressed range, after a genuine squeeze", () => {
    const setup = buildSqueezeSetup();
    const now = Date.now();
    const result = evaluate([...setup, currentBar("LONG", new Date(now - STEP_MS))]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.stopLossPrice).toBeLessThan(110);
    expect(result?.takeProfitPrice).toBeGreaterThan(110);
    expect(result?.meta?.priorAtrPercentile).toBeLessThanOrEqual(20);
  });

  it("fires SHORT on a real expansion breaking below the compressed range, after a genuine squeeze", () => {
    const setup = buildSqueezeSetup();
    const now = Date.now();
    const result = evaluate([...setup, currentBar("SHORT", new Date(now - STEP_MS))]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.stopLossPrice).toBeGreaterThan(90);
    expect(result?.takeProfitPrice).toBeLessThan(90);
  });
});

describe("VolatilitySqueezeStrategy — no signal without a genuine squeeze", () => {
  it("stays flat on the exact same breakout bar when the preceding history was never compressed", () => {
    const setup = buildNoSqueezeSetup();
    const now = Date.now();
    const result = evaluate([...setup, currentBar("LONG", new Date(now - STEP_MS))]);
    expect(result).toBeNull();
  });

  it("stays flat during the squeeze itself, before any expansion happens", () => {
    const setup = buildSqueezeSetup();
    expect(evaluate(setup)).toBeNull();
  });
});

describe("VolatilitySqueezeStrategy — no lookahead", () => {
  it("a future breakout bar has no effect until it legitimately becomes the current bar", () => {
    const setup = buildSqueezeSetup();
    const now = Date.now();
    expect(evaluate(setup)).toBeNull();

    const future = currentBar("LONG", new Date(now + STEP_MS));
    const result = evaluate([...setup, future]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });
});

describe("VolatilitySqueezeStrategy — insufficient history", () => {
  it("returns null with fewer than squeezeLookback+rangeLookback+atrPeriod+2 bars", () => {
    const tooFew = buildSqueezeSetup().slice(-30);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("VolatilitySqueezeStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const setup = buildSqueezeSetup();
    const now = Date.now();
    const bars = [...setup, currentBar("LONG", new Date(now - STEP_MS))];
    expect(evaluate(bars)).toEqual(evaluate(bars));
  });
});
