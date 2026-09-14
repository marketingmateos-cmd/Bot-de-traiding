import { describe, expect, it } from "vitest";
import { trendFollowingBaselineStrategy } from "../trendFollowingBaseline";
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

function makeTrendingBars(count: number, startPrice: number, driftPerBar: number): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  let price = startPrice;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    price = price * (1 + driftPerBar);
    return { timestamp: new Date(now - (count - i) * stepMs), open, high: Math.max(open, price) * 1.001, low: Math.min(open, price) * 0.999, close: price, volume: 1000 };
  });
}

function evaluate(bars: OHLCVBar[]) {
  return trendFollowingBaselineStrategy.evaluate(bars, DUMMY_FEATURES, trendFollowingBaselineStrategy.defaultParams, "NEUTRAL");
}

describe("TrendFollowingBaselineStrategy — correct signal", () => {
  it("fires LONG (bullish) once the fast SMA crosses above the slow SMA", () => {
    const bars = makeTrendingBars(60, 100, 0.003); // steady uptrend, 60 bars (> slowPeriod=50)
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = bars[bars.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);
  });

  it("fires SHORT (bearish) once the fast SMA crosses below the slow SMA", () => {
    const bars = makeTrendingBars(60, 100, -0.003); // steady downtrend
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const entry = bars[bars.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(entry);
    expect(result?.takeProfitPrice).toBeLessThan(entry);
  });
});

describe("TrendFollowingBaselineStrategy — no lookahead", () => {
  it("a future trend reversal has no effect until those bars legitimately become part of the history", () => {
    const uptrend = makeTrendingBars(60, 100, 0.003);
    const resultBefore = evaluate(uptrend);
    expect(resultBefore?.direction).toBe("LONG");

    // Appending a sharp downtrend AFTER the uptrend eventually flips the
    // fast/slow SMA relationship — but only once those bars are legitimately
    // part of the passed-in history, never retroactively.
    const reversal = makeTrendingBars(60, uptrend[uptrend.length - 1].close, -0.01);
    const combined = [...uptrend, ...reversal];
    const resultAfter = evaluate(combined);
    expect(resultAfter?.direction).toBe("SHORT");
  });
});

describe("TrendFollowingBaselineStrategy — insufficient history", () => {
  it("returns null when there aren't even `slowPeriod` prior bars", () => {
    const tooFew = makeTrendingBars(10, 100, 0.003); // default slowPeriod = 50
    expect(evaluate(tooFew)).toBeNull();
  });
});
