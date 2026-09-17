import { describe, expect, it } from "vitest";
import { maCrossMomentumFtmoStrategy } from "../maCrossMomentumFtmo";
import { ema, rsi } from "@/lib/engines/features";
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

function makeTwoLegBars(leg1Count: number, leg2Count: number, startPrice: number, leg1Drift: number, leg2Drift: number): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  const total = leg1Count + leg2Count;
  let price = startPrice;
  const closes: number[] = [];
  for (let i = 0; i < leg1Count; i++) {
    price = price * (1 + leg1Drift);
    closes.push(price);
  }
  for (let i = 0; i < leg2Count; i++) {
    price = price * (1 + leg2Drift);
    closes.push(price);
  }
  return closes.map((close, i) => ({
    timestamp: new Date(now - (total - i) * stepMs),
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 1000,
  }));
}

function evaluate(bars: OHLCVBar[]) {
  return maCrossMomentumFtmoStrategy.evaluate(bars, DUMMY_FEATURES, maCrossMomentumFtmoStrategy.defaultParams, "BULL");
}

const { fastPeriod, slowPeriod, momentumPeriod, momentumThreshold } = maCrossMomentumFtmoStrategy.defaultParams as {
  fastPeriod: number;
  slowPeriod: number;
  momentumPeriod: number;
  momentumThreshold: number;
};

// Locates, using the SAME feature-engine primitives the strategy itself
// relies on, the first bar index of a genuine event-triggered EMA cross
// (fast <= slow on the prior bar, fast > slow on this one) that coincides
// with RSI momentum confirmation — never a hand-picked magic index.
function findCrossIndex(bars: OHLCVBar[], direction: "LONG" | "SHORT"): number | null {
  const closes = bars.map((b) => b.close);
  const fastArr = ema(closes, fastPeriod);
  const slowArr = ema(closes, slowPeriod);
  const rsiArr = rsi(closes, momentumPeriod);
  for (let i = 1; i < closes.length; i++) {
    const fastNow = fastArr[i];
    const slowNow = slowArr[i];
    const fastPrev = fastArr[i - 1];
    const slowPrev = slowArr[i - 1];
    const rsiValue = rsiArr[i];
    if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null || rsiValue === null) continue;
    if (direction === "LONG" && fastPrev <= slowPrev && fastNow > slowNow && rsiValue > momentumThreshold) return i;
    if (direction === "SHORT" && fastPrev >= slowPrev && fastNow < slowNow && rsiValue < 100 - momentumThreshold) return i;
  }
  return null;
}

describe("MaCrossMomentumFtmoStrategy — correct signal", () => {
  it("fires LONG exactly at the bar where a fresh bullish EMA cross coincides with confirmed momentum", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02); // steady decline then a sharp reversal up
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    const upToCross = bars.slice(0, idx + 1);
    const result = evaluate(upToCross);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = upToCross[upToCross.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);

    // One bar earlier the cross had not happened yet — must stay flat.
    const beforeCross = bars.slice(0, idx);
    expect(evaluate(beforeCross)).toBeNull();
  });

  it("fires SHORT exactly at the bar where a fresh bearish EMA cross coincides with confirmed momentum", () => {
    const bars = makeTwoLegBars(40, 25, 80, 0.006, -0.02); // steady rise then a sharp reversal down
    const crossIndex = findCrossIndex(bars, "SHORT");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    const upToCross = bars.slice(0, idx + 1);
    const result = evaluate(upToCross);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const entry = upToCross[upToCross.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(entry);
    expect(result?.takeProfitPrice).toBeLessThan(entry);
  });
});

describe("MaCrossMomentumFtmoStrategy — event, not state", () => {
  it("does not refire on the very next bar even though fast stays above slow (event-based, not persistent-state)", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;
    expect(idx + 1).toBeLessThan(bars.length);

    const crossResult = evaluate(bars.slice(0, idx + 1));
    expect(crossResult?.direction).toBe("LONG");

    // Trend Following Baseline (state-based) would fire again here since
    // fastMA is still above slowMA; this event-based strategy must not,
    // because there was no NEW cross on this bar.
    const nextBarResult = evaluate(bars.slice(0, idx + 2));
    expect(nextBarResult).toBeNull();
  });
});

describe("MaCrossMomentumFtmoStrategy — insufficient history", () => {
  it("returns null when there aren't even `slowPeriod` + 2 prior bars", () => {
    const tooFew = makeTwoLegBars(20, 5, 100, -0.002, 0.01); // default slowPeriod = 30, needs 32
    expect(evaluate(tooFew)).toBeNull();
  });
});
