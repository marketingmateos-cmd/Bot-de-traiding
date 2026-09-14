import { describe, expect, it } from "vitest";
import { volumeConfirmationStrategy } from "../volumeConfirmation";
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

const STEP_MS = 3_600_000;

function bar(close: number, volume: number, timestamp: Date, noiseSeed = 0): OHLCVBar {
  const wobble = (noiseSeed % 2 === 0 ? 1 : -1) * 0.05;
  const c = close + wobble;
  return { timestamp, open: c, high: c + 0.3, low: c - 0.3, close: c, volume };
}

/** Flat-price, normal-volume warmup (25 bars) — no price move, no volume anomaly, so nothing should fire on it alone. */
function makeWarmup(count = 25, price = 100, volume = 1000): OHLCVBar[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => bar(price, volume, new Date(now - (count + 5 - i) * STEP_MS), i));
}

function evaluate(bars: OHLCVBar[]) {
  return volumeConfirmationStrategy.evaluate(bars, DUMMY_FEATURES, volumeConfirmationStrategy.defaultParams, "NEUTRAL");
}

describe("VolumeConfirmationStrategy — correct signal", () => {
  it("fires LONG on a rise confirmed by abnormally high volume", () => {
    const warmup = makeWarmup();
    const now = Date.now();
    // 5 bars ago close ~100, current close 103 (~3% > 1% threshold), with a big volume spike.
    const priceRun = [
      bar(101, 1000, new Date(now - 4 * STEP_MS)),
      bar(101.5, 1000, new Date(now - 3 * STEP_MS)),
      bar(102, 1000, new Date(now - 2 * STEP_MS)),
      bar(102.5, 1000, new Date(now - 1 * STEP_MS)),
    ];
    const current = { timestamp: new Date(now), open: 103, high: 103.3, low: 102.7, close: 103, volume: 5000 };
    const result = evaluate([...warmup, ...priceRun, current]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.stopLossPrice).toBeLessThan(103);
    expect(result?.takeProfitPrice).toBeGreaterThan(103);
    expect(result?.meta?.volumeZ).toBeGreaterThan(1.5);
  });

  it("fires SHORT on a drop confirmed by abnormally high volume", () => {
    const warmup = makeWarmup();
    const now = Date.now();
    const priceRun = [
      bar(99, 1000, new Date(now - 4 * STEP_MS)),
      bar(98.5, 1000, new Date(now - 3 * STEP_MS)),
      bar(98, 1000, new Date(now - 2 * STEP_MS)),
      bar(97.5, 1000, new Date(now - 1 * STEP_MS)),
    ];
    const current = { timestamp: new Date(now), open: 97, high: 97.3, low: 96.7, close: 97, volume: 5000 };
    const result = evaluate([...warmup, ...priceRun, current]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.stopLossPrice).toBeGreaterThan(97);
    expect(result?.takeProfitPrice).toBeLessThan(97);
  });
});

describe("VolumeConfirmationStrategy — no signal without volume confirmation", () => {
  it("stays flat on the exact same price move when volume is normal (not anomalous)", () => {
    const warmup = makeWarmup();
    const now = Date.now();
    const priceRun = [
      bar(101, 1000, new Date(now - 4 * STEP_MS)),
      bar(101.5, 1000, new Date(now - 3 * STEP_MS)),
      bar(102, 1000, new Date(now - 2 * STEP_MS)),
      bar(102.5, 1000, new Date(now - 1 * STEP_MS)),
    ];
    // Same price move as the LONG test, but NO volume spike.
    const current = { timestamp: new Date(now), open: 103, high: 103.3, low: 102.7, close: 103, volume: 1000 };
    expect(evaluate([...warmup, ...priceRun, current])).toBeNull();
  });

  it("stays flat when volume spikes but the price barely moved", () => {
    const warmup = makeWarmup();
    const now = Date.now();
    const current = { timestamp: new Date(now), open: 100.05, high: 100.2, low: 99.9, close: 100.05, volume: 6000 };
    expect(evaluate([...warmup, current])).toBeNull();
  });
});

describe("VolumeConfirmationStrategy — no lookahead", () => {
  it("a future confirmed move has no effect until it legitimately becomes the current bar", () => {
    const warmup = makeWarmup();
    const now = Date.now();
    expect(evaluate(warmup)).toBeNull();

    const future = { timestamp: new Date(now + 10 * STEP_MS), open: 103, high: 103.3, low: 102.7, close: 103, volume: 6000 };
    const result = evaluate([...warmup, future]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });
});

describe("VolumeConfirmationStrategy — insufficient history", () => {
  it("returns null with fewer than max(priceLookback, volumeZPeriod)+1 bars", () => {
    const tooFew = makeWarmup(10);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("VolumeConfirmationStrategy — edge cases de volumen", () => {
  it("returns null (never NaN/throws) when volume has been perfectly constant (zero variance z-score)", () => {
    const flatVolume = makeWarmup(25, 100, 1000);
    const current = { timestamp: new Date(), open: 105, high: 105.3, low: 104.7, close: 105, volume: 1000 };
    const result = evaluate([...flatVolume, current]);
    expect(result).toBeNull();
  });
});

describe("VolumeConfirmationStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const warmup = makeWarmup();
    const now = Date.now();
    const current = { timestamp: new Date(now), open: 103, high: 103.3, low: 102.7, close: 103, volume: 6000 };
    const bars = [...warmup, current];
    expect(evaluate(bars)).toEqual(evaluate(bars));
  });
});
