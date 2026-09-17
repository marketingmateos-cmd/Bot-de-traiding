import { describe, expect, it } from "vitest";
import { meanReversionFtmoStrategy } from "../meanReversionFtmo";
import { bollingerBands, rsi } from "@/lib/engines/features";
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

function makeBarsFromCloses(closes: number[]): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  const count = closes.length;
  return closes.map((close, i) => ({
    timestamp: new Date(now - (count - i) * stepMs),
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 1000,
  }));
}

function makeOscillatingBars(count: number, price = 100): OHLCVBar[] {
  const closes = Array.from({ length: count }, (_, i) => price + (i % 2 === 0 ? 0.15 : -0.15));
  return makeBarsFromCloses(closes);
}

function evaluate(bars: OHLCVBar[]) {
  return meanReversionFtmoStrategy.evaluate(bars, DUMMY_FEATURES, meanReversionFtmoStrategy.defaultParams, "RANGE");
}

const { period, stdDevMultiplier, rsiPeriod, rsiOversold, rsiOverbought } = meanReversionFtmoStrategy.defaultParams as {
  period: number;
  stdDevMultiplier: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
};

// Locates, using the SAME feature-engine primitives the strategy itself
// relies on, the first bar index where price and RSI agree on a reversal
// condition — the exact double-confirmation the strategy is meant to detect.
// This avoids hand-tuning magic-number prices that happen to "look" extreme.
// The search starts at the strategy's own minimum-history threshold
// (max(period, rsiPeriod + 1)) so the found index is always evaluable —
// an earlier index would satisfy the band/RSI condition in isolation but
// still be rejected by evaluate()'s insufficient-history guard.
function findSignalIndex(bars: OHLCVBar[], direction: "LONG" | "SHORT"): number | null {
  const closes = bars.map((b) => b.close);
  const bands = bollingerBands(closes, period, stdDevMultiplier);
  const rsiArr = rsi(closes, rsiPeriod);
  const minIndex = Math.max(period, rsiPeriod + 1);
  for (let i = minIndex; i < closes.length; i++) {
    const rsiValue = rsiArr[i];
    if (rsiValue === null) continue;
    if (direction === "LONG") {
      const lower = bands.lower[i];
      if (lower !== null && closes[i] <= lower && rsiValue <= rsiOversold) return i;
    } else {
      const upper = bands.upper[i];
      if (upper !== null && closes[i] >= upper && rsiValue >= rsiOverbought) return i;
    }
  }
  return null;
}

describe("MeanReversionFtmoStrategy — correct signal", () => {
  it("fires LONG once price sits at/below the lower Bollinger band AND RSI confirms oversold", () => {
    const stable = Array.from({ length: 15 }, (_, i) => 100 + (i % 2 === 0 ? 0.15 : -0.15));
    const decline = Array.from({ length: 25 }, (_, i) => stable[stable.length - 1] * Math.pow(1 - 0.006, i + 1));
    const closes = [...stable, ...decline];
    const bars = makeBarsFromCloses(closes);

    const signalIndex = findSignalIndex(bars, "LONG");
    expect(signalIndex).not.toBeNull();
    const upToSignal = bars.slice(0, (signalIndex as number) + 1);
    const result = evaluate(upToSignal);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = upToSignal[upToSignal.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);
  });

  it("fires SHORT once price sits at/above the upper Bollinger band AND RSI confirms overbought", () => {
    const stable = Array.from({ length: 15 }, (_, i) => 100 + (i % 2 === 0 ? 0.15 : -0.15));
    const rally = Array.from({ length: 25 }, (_, i) => stable[stable.length - 1] * Math.pow(1 + 0.006, i + 1));
    const closes = [...stable, ...rally];
    const bars = makeBarsFromCloses(closes);

    const signalIndex = findSignalIndex(bars, "SHORT");
    expect(signalIndex).not.toBeNull();
    const upToSignal = bars.slice(0, (signalIndex as number) + 1);
    const result = evaluate(upToSignal);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const entry = upToSignal[upToSignal.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(entry);
    expect(result?.takeProfitPrice).toBeLessThan(entry);
  });

  it("stays flat while price wobbles within a normal range around the mean (no double confirmation)", () => {
    const bars = makeOscillatingBars(26, 100);
    expect(evaluate(bars)).toBeNull();
  });
});

describe("MeanReversionFtmoStrategy — double confirmation discipline", () => {
  it("does not fire on a band touch alone without RSI confirming the same extreme", () => {
    // A mild single-bar dip is already enough to pierce the (very tight)
    // lower band of an otherwise-flat series, but is far too small on its
    // own to drag Wilder-smoothed RSI(14) into oversold territory — exactly
    // the marginal, single-condition case this strategy is designed to reject.
    const stable = makeOscillatingBars(25, 100);
    const singleDip = { timestamp: new Date(), open: 99.5, high: 99.7, low: 99.3, close: 99.5, volume: 1000 };
    const bars = [...stable, singleDip];
    const closes = bars.map((b) => b.close);
    const bands = bollingerBands(closes, period, stdDevMultiplier);
    const rsiArr = rsi(closes, rsiPeriod);
    const lastLower = bands.lower[bands.lower.length - 1];
    const lastRsi = rsiArr[rsiArr.length - 1];
    expect(lastLower).not.toBeNull();
    expect(closes[closes.length - 1]).toBeLessThanOrEqual(lastLower as number); // band condition alone IS met
    expect(lastRsi === null || (lastRsi as number) > rsiOversold).toBe(true); // RSI alone is NOT oversold yet
    expect(evaluate(bars)).toBeNull();
  });
});

describe("MeanReversionFtmoStrategy — insufficient history", () => {
  it("returns null when there aren't even `period` prior bars", () => {
    const tooFew = makeOscillatingBars(5, 100); // default period = 20
    expect(evaluate(tooFew)).toBeNull();
  });
});
