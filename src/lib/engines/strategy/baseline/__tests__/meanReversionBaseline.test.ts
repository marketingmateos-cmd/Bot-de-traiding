import { describe, expect, it } from "vitest";
import { meanReversionBaselineStrategy } from "../meanReversionBaseline";
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

function bar(price: number, timestamp: Date, noiseSeed = 0): OHLCVBar {
  // A little bar-to-bar wobble around `price` so ATR/std-dev are nonzero
  // (a perfectly flat series would give a zero stop distance and reject
  // every signal), while keeping the mean stable and predictable.
  const wobble = (noiseSeed % 2 === 0 ? 1 : -1) * 0.15;
  const close = price + wobble;
  return { timestamp, open: close, high: close + 0.3, low: close - 0.3, close, volume: 1000 };
}

function makeOscillatingBars(count: number, price = 100): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  return Array.from({ length: count }, (_, i) => bar(price, new Date(now - (count - i) * stepMs), i));
}

function evaluate(bars: OHLCVBar[]) {
  return meanReversionBaselineStrategy.evaluate(bars, DUMMY_FEATURES, meanReversionBaselineStrategy.defaultParams, "NEUTRAL");
}

describe("MeanReversionBaselineStrategy — correct signal", () => {
  it("fires LONG when the price is deviated far below its mean (oversold)", () => {
    const warmup = makeOscillatingBars(25, 100); // mean ~100, std dev ~0.15
    const deepDip = { timestamp: new Date(), open: 97, high: 97.2, low: 96.8, close: 97, volume: 1000 }; // ~20 std devs below mean
    const result = evaluate([...warmup, deepDip]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.stopLossPrice).toBeLessThan(97);
    expect(result?.takeProfitPrice).toBeGreaterThan(97);
  });

  it("fires SHORT when the price is deviated far above its mean (overbought)", () => {
    const warmup = makeOscillatingBars(25, 100);
    const spike = { timestamp: new Date(), open: 103, high: 103.2, low: 102.8, close: 103, volume: 1000 };
    const result = evaluate([...warmup, spike]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.stopLossPrice).toBeGreaterThan(103);
    expect(result?.takeProfitPrice).toBeLessThan(103);
  });

  it("stays flat while the price wobbles within a normal range around the mean", () => {
    const bars = makeOscillatingBars(26, 100);
    expect(evaluate(bars)).toBeNull();
  });
});

describe("MeanReversionBaselineStrategy — no lookahead", () => {
  it("a future extreme bar has no effect until it legitimately becomes the current bar", () => {
    const warmup = makeOscillatingBars(25, 100);
    expect(evaluate(warmup)).toBeNull();

    const futureDip = { timestamp: new Date(Date.now() + 3_600_000), open: 97, high: 97.2, low: 96.8, close: 97, volume: 1000 };
    const result = evaluate([...warmup, futureDip]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });
});

describe("MeanReversionBaselineStrategy — insufficient history", () => {
  it("returns null when there aren't even `meanPeriod` prior bars", () => {
    const tooFew = makeOscillatingBars(5, 100); // default meanPeriod = 20
    expect(evaluate(tooFew)).toBeNull();
  });
});
