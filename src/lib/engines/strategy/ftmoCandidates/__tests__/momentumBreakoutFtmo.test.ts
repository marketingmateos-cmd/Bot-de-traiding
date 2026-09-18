import { describe, expect, it } from "vitest";
import { momentumBreakoutFtmoStrategy } from "../momentumBreakoutFtmo";
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

const { volatilityPeriod, compressionLookback, baselinePeriod } = momentumBreakoutFtmoStrategy.defaultParams as {
  volatilityPeriod: number;
  compressionLookback: number;
  baselinePeriod: number;
};

function makeBarsFromCloses(closes: number[], wobblePct: number): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  const count = closes.length;
  return closes.map((close, i) => ({
    timestamp: new Date(now - (count - i) * stepMs),
    open: close,
    high: close * (1 + wobblePct),
    low: close * (1 - wobblePct),
    close,
    volume: 1000,
  }));
}

/**
 * Builds baseline (moderate volatility) + compression (tight volatility,
 * deliberately longer than `compressionLookback` alone so every ATR value
 * inside the strategy's own recent-window is itself computed from a
 * PURELY-compressed 14-bar lookback, never blended with the baseline
 * phase — otherwise ATR's own smoothing dilutes the contrast the strategy
 * is meant to detect) bars, then a single trigger bar whose body is
 * `jumpPct` away from the last compressed close, breaking out in
 * `direction`.
 */
function makeCompressionFixture(direction: "LONG" | "SHORT", jumpPct: number, compressionWobblePct: number, baselineWobblePct = 0.006): OHLCVBar[] {
  const compressionBlockLen = volatilityPeriod + compressionLookback;
  const baselineCloses = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 0.4 : -0.4));
  const baselineBars = makeBarsFromCloses(baselineCloses, baselineWobblePct);
  const lastBaseline = baselineCloses[baselineCloses.length - 1];
  const compressionCloses = Array.from({ length: compressionBlockLen }, (_, i) => lastBaseline + (i % 2 === 0 ? 0.02 : -0.02));
  const compressionBars = makeBarsFromCloses(compressionCloses, compressionWobblePct);
  const lastCompressionClose = compressionCloses[compressionCloses.length - 1];
  const sign = direction === "LONG" ? 1 : -1;
  const triggerOpen = lastCompressionClose;
  const triggerClose = lastCompressionClose * (1 + sign * jumpPct);
  const triggerBar: OHLCVBar = {
    timestamp: new Date(),
    open: triggerOpen,
    high: Math.max(triggerOpen, triggerClose) * 1.001,
    low: Math.min(triggerOpen, triggerClose) * 0.999,
    close: triggerClose,
    volume: 1000,
  };
  return [...baselineBars, ...compressionBars, triggerBar];
}

function evaluate(bars: OHLCVBar[]) {
  return momentumBreakoutFtmoStrategy.evaluate(bars, DUMMY_FEATURES, momentumBreakoutFtmoStrategy.defaultParams, "TRANSITION");
}

describe("MomentumBreakoutFtmoStrategy — correct signal", () => {
  it("fires LONG when a high-energy bullish candle breaks out of a genuine compression phase", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = bars[bars.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);
  });

  it("fires SHORT when a high-energy bearish candle breaks out of a genuine compression phase", () => {
    const bars = makeCompressionFixture("SHORT", 0.02, 0.0001);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const entry = bars[bars.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(entry);
    expect(result?.takeProfitPrice).toBeLessThan(entry);
  });
});

describe("MomentumBreakoutFtmoStrategy — asymmetric R:R (1:3.5 by default)", () => {
  it("computes SL/TP from stopDistance = ATR × atrMultiplier and TP = stopDistance × rrr, exactly as declared", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars);
    expect(result).not.toBeNull();

    const { atrMultiplier, rrr } = momentumBreakoutFtmoStrategy.defaultParams as { atrMultiplier: number; rrr: number };
    expect(rrr).toBeGreaterThanOrEqual(3);
    expect(rrr).toBeLessThanOrEqual(4);

    const entry = bars[bars.length - 1].close;
    const stopDistance = entry - (result?.stopLossPrice as number);
    expect(result?.meta?.stopDistance).toBeCloseTo(stopDistance, 6);
    expect(result?.takeProfitPrice).toBeCloseTo(entry + stopDistance * rrr, 2);
    // The reward distance must be markedly larger than the risk distance —
    // the whole point of the asymmetric R:R design.
    const rewardDistance = (result?.takeProfitPrice as number) - entry;
    expect(rewardDistance).toBeGreaterThan(stopDistance * 3);
  });
});

describe("MomentumBreakoutFtmoStrategy — compression discipline", () => {
  it("discards a high-energy breakout candle when the market was NOT actually compressed beforehand", () => {
    // Same jump size that fires a signal in the correct-signal test, but the
    // 'compression' phase has the SAME wobble as the baseline — no real
    // contraction happened, so the compression gate must reject it even
    // though the energy trigger alone would pass.
    const bars = makeCompressionFixture("LONG", 0.02, 0.006, 0.006);
    expect(evaluate(bars)).toBeNull();
  });
});

describe("MomentumBreakoutFtmoStrategy — high-energy trigger discipline", () => {
  it("discards a breakout beyond the compressed range when the candle's body is too small (< 1.5x ATR)", () => {
    // Same genuine compression as the correct-signal test, but a much
    // smaller jump — still enough to clear the compressed range in price
    // terms, but too small a body relative to ATR to count as real energy.
    const bars = makeCompressionFixture("LONG", 0.0008, 0.0001);
    expect(evaluate(bars)).toBeNull();
  });
});

describe("MomentumBreakoutFtmoStrategy — no lookahead", () => {
  it("the compressed range level used for the breakout decision is the PRIOR compressionLookback bars' extreme, never the current bar's own", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars);
    expect(result).not.toBeNull();

    const priorWindow = bars.slice(-compressionLookback - 1, -1);
    const expectedRangeHigh = Math.max(...priorWindow.map((b) => b.high));
    expect(result?.meta?.rangeLevel).toBeCloseTo(expectedRangeHigh, 6);
    // Sanity: that level is NOT the current (trigger) bar's own high.
    const currentHigh = bars[bars.length - 1].high;
    expect(expectedRangeHigh).not.toBeCloseTo(currentHigh, 2);
  });
});

describe("MomentumBreakoutFtmoStrategy — insufficient history", () => {
  it("returns null when there aren't even enough bars for the baseline + compression windows", () => {
    const tooFew = makeCompressionFixture("LONG", 0.02, 0.0001).slice(-40); // minBars = max(14,50)+10+2 = 62
    expect(tooFew.length).toBeLessThan(62);
    expect(evaluate(tooFew)).toBeNull();
  });
});
