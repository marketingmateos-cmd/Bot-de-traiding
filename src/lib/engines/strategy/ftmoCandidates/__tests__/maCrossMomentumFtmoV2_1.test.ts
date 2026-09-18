import { describe, expect, it } from "vitest";
import { maCrossMomentumFtmoV2_1Strategy } from "../maCrossMomentumFtmoV2_1";
import { maCrossMomentumFtmoV2Strategy } from "../maCrossMomentumFtmoV2";
import { ema, rsi, atr } from "@/lib/engines/features";
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

function evaluateV2_1(bars: OHLCVBar[]) {
  return maCrossMomentumFtmoV2_1Strategy.evaluate(bars, DUMMY_FEATURES, maCrossMomentumFtmoV2_1Strategy.defaultParams, "BULL");
}

function evaluateV2(bars: OHLCVBar[]) {
  return maCrossMomentumFtmoV2Strategy.evaluate(bars, DUMMY_FEATURES, maCrossMomentumFtmoV2Strategy.defaultParams, "BULL");
}

const { fastPeriod, slowPeriod, momentumPeriod, momentumThreshold, atrFilterPeriod, volatilityPeriod, atrFilterMultiplier } =
  maCrossMomentumFtmoV2_1Strategy.defaultParams as {
    fastPeriod: number;
    slowPeriod: number;
    momentumPeriod: number;
    momentumThreshold: number;
    atrFilterPeriod: number;
    volatilityPeriod: number;
    atrFilterMultiplier: number;
  };

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

describe("MaCrossMomentumFtmoV2_1Strategy — atrFilterMultiplier defaults to 0.75 (only change from v2)", () => {
  it("defaultParams.atrFilterMultiplier is 0.75, distinct from v2's 1.0", () => {
    expect(atrFilterMultiplier).toBe(0.75);
    expect(maCrossMomentumFtmoV2Strategy.defaultParams.atrFilterMultiplier).toBe(1);
  });
});

describe("MaCrossMomentumFtmoV2_1Strategy — correct signal (core logic preserved from v2)", () => {
  it("fires LONG exactly at the bar where a fresh bullish EMA cross coincides with confirmed momentum and normal volatility", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    const upToCross = bars.slice(0, idx + 1);
    const result = evaluateV2_1(upToCross);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = upToCross[upToCross.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);

    const beforeCross = bars.slice(0, idx);
    expect(evaluateV2_1(beforeCross)).toBeNull();
  });

  it("fires SHORT exactly at the bar where a fresh bearish EMA cross coincides with confirmed momentum and normal volatility", () => {
    const bars = makeTwoLegBars(40, 25, 80, 0.006, -0.02);
    const crossIndex = findCrossIndex(bars, "SHORT");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    const upToCross = bars.slice(0, idx + 1);
    const result = evaluateV2_1(upToCross);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const entry = upToCross[upToCross.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(entry);
    expect(result?.takeProfitPrice).toBeLessThan(entry);
  });
});

describe("MaCrossMomentumFtmoV2_1Strategy — 0.75x ATR floor relaxation (new in v2.1)", () => {
  it("accepts a cross+momentum signal whose ATR sits between 75% and 100% of its recent average — v2 (1.0x) must reject the SAME bars, v2.1 (0.75x) must accept them", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    // Same closes throughout (so EMA/RSI/cross timing is IDENTICAL for both
    // versions) — only high/low in the block strictly BEFORE the trigger
    // bar's own 14-bar ATR window are mildly widened, landing the trigger
    // bar's ATR-to-recent-average ratio in the [0.75, 1.0) gap the two
    // versions disagree on.
    const rigged = bars.map((bar, i) => {
      if (i >= idx - 13 && i <= idx) return bar;
      if (i >= idx - 33 && i < idx - 13) {
        return { ...bar, high: bar.close * 1.01, low: bar.close * 0.99 };
      }
      return bar;
    });
    const upToCross = rigged.slice(0, idx + 1);

    // Confirm the rig actually lands the ratio in the disputed band, using
    // the same primitive the strategies use — this test would be
    // meaningless if the rig didn't really trip the condition it claims to.
    const atrArr = atr(upToCross, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1] as number;
    const priorWindow = atrArr.slice(-atrFilterPeriod - 1, -1).filter((v): v is number => v !== null);
    const atrFloorFull = priorWindow.reduce((a, b) => a + b, 0) / priorWindow.length;
    const ratio = atrValue / atrFloorFull;
    expect(ratio).toBeGreaterThanOrEqual(0.75);
    expect(ratio).toBeLessThan(1);

    // v2 (100% threshold) must reject it...
    expect(evaluateV2(upToCross)).toBeNull();
    // ...while v2.1 (75% threshold) accepts the exact same bars.
    const result = evaluateV2_1(upToCross);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });

  it("still rejects a cross+momentum signal in a genuinely dead range, well below the relaxed 75% floor", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    const rigged = bars.map((bar, i) => {
      if (i >= idx - 13 && i <= idx) return bar;
      if (i >= idx - 33 && i < idx - 13) {
        return { ...bar, high: bar.close * 1.1, low: bar.close * 0.9 };
      }
      return bar;
    });
    const upToCross = rigged.slice(0, idx + 1);

    const atrArr = atr(upToCross, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1] as number;
    const priorWindow = atrArr.slice(-atrFilterPeriod - 1, -1).filter((v): v is number => v !== null);
    const atrFloorFull = priorWindow.reduce((a, b) => a + b, 0) / priorWindow.length;
    expect(atrValue).toBeLessThan(atrFloorFull * 0.75);

    expect(evaluateV2_1(upToCross)).toBeNull();
  });
});

describe("MaCrossMomentumFtmoV2_1Strategy — event, not state (preserved from v1/v2)", () => {
  it("does not refire on the very next bar even though fast stays above slow", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;
    expect(idx + 1).toBeLessThan(bars.length);

    const crossResult = evaluateV2_1(bars.slice(0, idx + 1));
    expect(crossResult?.direction).toBe("LONG");

    const nextBarResult = evaluateV2_1(bars.slice(0, idx + 2));
    expect(nextBarResult).toBeNull();
  });
});

describe("MaCrossMomentumFtmoV2_1Strategy — insufficient history", () => {
  it("returns null when there aren't even enough bars for both the EMA-cross window and the ATR-filter window", () => {
    const tooFew = makeTwoLegBars(20, 5, 100, -0.002, 0.01); // slowPeriod+2=32, but needs volatilityPeriod+atrFilterPeriod+1=35
    expect(tooFew.length).toBeLessThan(35);
    expect(evaluateV2_1(tooFew)).toBeNull();
  });
});
