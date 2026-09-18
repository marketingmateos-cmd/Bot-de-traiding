import { describe, expect, it } from "vitest";
import { maCrossMomentumFtmoV2Strategy } from "../maCrossMomentumFtmoV2";
import { maCrossMomentumFtmoStrategy } from "../maCrossMomentumFtmo";
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

function evaluateV2(bars: OHLCVBar[]) {
  return maCrossMomentumFtmoV2Strategy.evaluate(bars, DUMMY_FEATURES, maCrossMomentumFtmoV2Strategy.defaultParams, "BULL");
}

function evaluateV1(bars: OHLCVBar[]) {
  return maCrossMomentumFtmoStrategy.evaluate(bars, DUMMY_FEATURES, maCrossMomentumFtmoStrategy.defaultParams, "BULL");
}

const { fastPeriod, slowPeriod, momentumPeriod, momentumThreshold, atrFilterPeriod, volatilityPeriod, baseRrr, momentumRrrBonus } =
  maCrossMomentumFtmoV2Strategy.defaultParams as {
    fastPeriod: number;
    slowPeriod: number;
    momentumPeriod: number;
    momentumThreshold: number;
    atrFilterPeriod: number;
    volatilityPeriod: number;
    baseRrr: number;
    momentumRrrBonus: number;
  };

// Same empirical index finder as the v1 test suite — locates a genuine
// event-triggered EMA cross confirmed by momentum, using the same
// feature-engine primitives the strategy itself relies on.
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

describe("MaCrossMomentumFtmoV2Strategy — correct signal (core logic preserved from v1)", () => {
  it("fires LONG exactly at the bar where a fresh bullish EMA cross coincides with confirmed momentum and normal volatility", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    const upToCross = bars.slice(0, idx + 1);
    const result = evaluateV2(upToCross);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = upToCross[upToCross.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);

    const beforeCross = bars.slice(0, idx);
    expect(evaluateV2(beforeCross)).toBeNull();
  });

  it("fires SHORT exactly at the bar where a fresh bearish EMA cross coincides with confirmed momentum and normal volatility", () => {
    const bars = makeTwoLegBars(40, 25, 80, 0.006, -0.02);
    const crossIndex = findCrossIndex(bars, "SHORT");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    const upToCross = bars.slice(0, idx + 1);
    const result = evaluateV2(upToCross);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const entry = upToCross[upToCross.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(entry);
    expect(result?.takeProfitPrice).toBeLessThan(entry);
  });
});

describe("MaCrossMomentumFtmoV2Strategy — ATR floor discipline (new in v2)", () => {
  it("discards a cross+momentum signal that would otherwise fire if the trigger bar's volatility collapses below its own recent average", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;

    // Same closes throughout (so EMA/RSI/cross timing is IDENTICAL) — only
    // high/low are altered, which only affects True Range / ATR, never the
    // cross or momentum decision. ATR(volatilityPeriod=14) is itself a
    // trailing 14-bar average, so the trigger bar's OWN ATR depends on
    // bars [idx-13, idx] — that window is left untouched (a real, modest
    // volatility spike from the natural price move). The block strictly
    // BEFORE that window gets artificially WIDE wicks, inflating the
    // recent-ATR average this trigger bar must clear — a textbook "false
    // signal right after volatility has already collapsed back down" the
    // ATR floor exists to reject.
    const rigged = bars.map((bar, i) => {
      if (i >= idx - 13 && i <= idx) return bar;
      if (i >= idx - (13 + atrFilterPeriod) && i < idx - 13) {
        return { ...bar, high: bar.close * 1.1, low: bar.close * 0.9 };
      }
      return bar;
    });
    const upToCross = rigged.slice(0, idx + 1);

    // Confirm the rigged trigger bar's ATR really does fall below its own
    // recent-average floor, using the same primitive the strategy uses —
    // this test would be meaningless if the rig didn't actually trip the
    // condition it claims to.
    const atrArr = atr(upToCross, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1] as number;
    const priorWindow = atrArr.slice(-atrFilterPeriod - 1, -1).filter((v): v is number => v !== null);
    const atrFloor = priorWindow.reduce((a, b) => a + b, 0) / priorWindow.length;
    expect(atrValue).toBeLessThan(atrFloor);

    // v2 must discard it...
    expect(evaluateV2(upToCross)).toBeNull();
    // ...while v1 (no ATR floor) still fires on the exact same bars, proving
    // the ATR floor — not some other side effect of the rig — is what
    // blocked v2.
    expect(evaluateV1(upToCross)?.direction).toBe("LONG");
  });
});

describe("MaCrossMomentumFtmoV2Strategy — dynamic take profit scales with momentum intensity (new in v2)", () => {
  it("computes the LONG take-profit RRR from the exact momentumIntensity/baseRrr/momentumRrrBonus formula", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const upToCross = bars.slice(0, (crossIndex as number) + 1);

    const result = evaluateV2(upToCross);
    expect(result).not.toBeNull();

    const rsiArr = rsi(
      upToCross.map((b) => b.close),
      momentumPeriod
    );
    const rsiValue = rsiArr[rsiArr.length - 1] as number;
    const expectedIntensity = Math.min(1, (rsiValue - momentumThreshold) / (100 - momentumThreshold));
    const expectedRrr = baseRrr + expectedIntensity * momentumRrrBonus;

    expect(result?.meta?.rrr).toBeCloseTo(expectedRrr, 5);
    // Always within the documented dynamic range [baseRrr, baseRrr + momentumRrrBonus].
    expect(result?.meta?.rrr as number).toBeGreaterThanOrEqual(baseRrr);
    expect(result?.meta?.rrr as number).toBeLessThanOrEqual(baseRrr + momentumRrrBonus);

    const entry = upToCross[upToCross.length - 1].close;
    const stopDistance = entry - (result?.stopLossPrice as number);
    expect(result?.takeProfitPrice).toBeCloseTo(entry + stopDistance * expectedRrr, 2);
  });

  it("gives a stronger-momentum cross a wider take-profit distance than a marginal-momentum cross", () => {
    // A sharper leg-2 reversal drives RSI further past momentumThreshold,
    // i.e. higher momentum intensity at the trigger bar.
    const marginalBars = makeTwoLegBars(40, 25, 120, -0.006, 0.006);
    const strongBars = makeTwoLegBars(40, 25, 120, -0.006, 0.03);

    const marginalIdx = findCrossIndex(marginalBars, "LONG");
    const strongIdx = findCrossIndex(strongBars, "LONG");
    expect(marginalIdx).not.toBeNull();
    expect(strongIdx).not.toBeNull();

    const marginalResult = evaluateV2(marginalBars.slice(0, (marginalIdx as number) + 1));
    const strongResult = evaluateV2(strongBars.slice(0, (strongIdx as number) + 1));
    expect(marginalResult).not.toBeNull();
    expect(strongResult).not.toBeNull();

    expect(strongResult?.meta?.rrr as number).toBeGreaterThan(marginalResult?.meta?.rrr as number);

    const marginalEntry = marginalBars[marginalIdx as number].close;
    const strongEntry = strongBars[strongIdx as number].close;
    const marginalTpDistancePct = ((marginalResult?.takeProfitPrice as number) - marginalEntry) / marginalEntry;
    const strongTpDistancePct = ((strongResult?.takeProfitPrice as number) - strongEntry) / strongEntry;
    expect(strongTpDistancePct).toBeGreaterThan(marginalTpDistancePct);
  });
});

describe("MaCrossMomentumFtmoV2Strategy — event, not state (preserved from v1)", () => {
  it("does not refire on the very next bar even though fast stays above slow", () => {
    const bars = makeTwoLegBars(40, 25, 120, -0.006, 0.02);
    const crossIndex = findCrossIndex(bars, "LONG");
    expect(crossIndex).not.toBeNull();
    const idx = crossIndex as number;
    expect(idx + 1).toBeLessThan(bars.length);

    const crossResult = evaluateV2(bars.slice(0, idx + 1));
    expect(crossResult?.direction).toBe("LONG");

    const nextBarResult = evaluateV2(bars.slice(0, idx + 2));
    expect(nextBarResult).toBeNull();
  });
});

describe("MaCrossMomentumFtmoV2Strategy — insufficient history", () => {
  it("returns null when there aren't even enough bars for both the EMA-cross window and the ATR-filter window", () => {
    const tooFew = makeTwoLegBars(20, 5, 100, -0.002, 0.01); // slowPeriod+2=32, but v2 also needs volatilityPeriod+atrFilterPeriod+1=35
    expect(tooFew.length).toBeLessThan(35);
    expect(evaluateV2(tooFew)).toBeNull();
  });
});
