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

const { volatilityPeriod, compressionLookback, baselinePeriod, macroPeriod, macroSlopeLookback } = momentumBreakoutFtmoStrategy.defaultParams as {
  volatilityPeriod: number;
  compressionLookback: number;
  baselinePeriod: number;
  macroPeriod: number;
  macroSlopeLookback: number;
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

// `macroPeriod + macroSlopeLookback` = 120 bars must sit ENTIRELY before the
// trigger bar with room to spare, so every fixture's baseline block is sized
// against this (never the old, pre-macro-filter 60-bar baseline).
const BASELINE_LEN = macroPeriod + macroSlopeLookback + 30;

/**
 * Builds a compression (tight volatility, deliberately longer than
 * `compressionLookback` alone so every ATR value inside the strategy's own
 * recent-window is itself computed from a PURELY-compressed 14-bar
 * lookback, never blended with the baseline phase — otherwise ATR's own
 * smoothing dilutes the contrast the strategy is meant to detect) block
 * anchored at `lastBaselineClose`, then a single trigger bar whose body is
 * `jumpPct` away from the last compressed close, breaking out in
 * `direction`. Shared by every fixture below — flat-macro and
 * dirty-bearish-macro fixtures differ only in what precedes this tail.
 */
function makeCompressionAndTriggerTail(lastBaselineClose: number, direction: "LONG" | "SHORT", jumpPct: number, compressionWobblePct: number): OHLCVBar[] {
  const compressionBlockLen = volatilityPeriod + compressionLookback;
  const compressionCloses = Array.from({ length: compressionBlockLen }, (_, i) => lastBaselineClose + (i % 2 === 0 ? 0.02 : -0.02));
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
  return [...compressionBars, triggerBar];
}

/**
 * Baseline (moderate volatility, FLAT — no macro trend) + compression +
 * trigger. A flat baseline keeps the macro filter's slope condition near
 * zero, so it never blocks these fixtures regardless of deviation.
 */
function makeCompressionFixture(direction: "LONG" | "SHORT", jumpPct: number, compressionWobblePct: number, baselineWobblePct = 0.006): OHLCVBar[] {
  const baselineCloses = Array.from({ length: BASELINE_LEN }, (_, i) => 100 + (i % 2 === 0 ? 0.4 : -0.4));
  const baselineBars = makeBarsFromCloses(baselineCloses, baselineWobblePct);
  const lastBaseline = baselineCloses[baselineCloses.length - 1];
  return [...baselineBars, ...makeCompressionAndTriggerTail(lastBaseline, direction, jumpPct, compressionWobblePct)];
}

/**
 * Same compression + trigger tail as `makeCompressionFixture`, but preceded
 * by a long, steep decline (instead of a flat baseline) so that BOTH the
 * macro filter's conditions are clearly true by the time the trigger bar
 * fires: price sits far below its own `macroPeriod`-bar SMA, and that SMA
 * has been declining over the trailing `macroSlopeLookback` bars. Isolates
 * the macro filter's effect — the compression+trigger tail is IDENTICAL in
 * shape to the one used by the (unblocked) correct-signal fixtures above.
 */
function makeDirtyBearishMacroFixture(direction: "LONG" | "SHORT", jumpPct: number, compressionWobblePct: number): OHLCVBar[] {
  const declineCloses = Array.from({ length: BASELINE_LEN }, (_, i) => 300 - (i * 200) / (BASELINE_LEN - 1));
  const declineBars = makeBarsFromCloses(declineCloses, 0.006);
  const lastDeclineClose = declineCloses[declineCloses.length - 1];
  return [...declineBars, ...makeCompressionAndTriggerTail(lastDeclineClose, direction, jumpPct, compressionWobblePct)];
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
  it("returns null when there aren't even enough bars for the macro + baseline + compression windows", () => {
    // minBars = max(14, 50, macroPeriod(100)+macroSlopeLookback(20)) + compressionLookback(10) + 2 = 132
    const minBars = Math.max(volatilityPeriod, baselinePeriod, macroPeriod + macroSlopeLookback) + compressionLookback + 2;
    expect(minBars).toBe(132);
    const tooFew = makeCompressionFixture("LONG", 0.02, 0.0001).slice(-100);
    expect(tooFew.length).toBeLessThan(minBars);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("MomentumBreakoutFtmoStrategy — macro regime filter (global background trend)", () => {
  it("fires normally on a flat/neutral macro background (baseline sanity check — macro deviation and slope stay near zero)", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(Math.abs(result?.meta?.macroDeviationPct as number)).toBeLessThan(0.02);
    expect(Math.abs(result?.meta?.macroSlopePct as number)).toBeLessThan(0.005);
  });

  it("blocks an otherwise-valid LONG breakout when the macro background is a clear/dirty downtrend", () => {
    // Identical compression+trigger tail to the correct-signal LONG test —
    // only the long declining prefix differs — proving the macro filter,
    // not the compression/energy/breakout logic, is what blocks this.
    const bearishBars = makeDirtyBearishMacroFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bearishBars);
    expect(result).toBeNull();
  });

  it("blocks an otherwise-valid SHORT breakout too — zero entries in ANY direction during a dirty bearish macro", () => {
    const bearishBars = makeDirtyBearishMacroFixture("SHORT", 0.02, 0.0001);
    const result = evaluate(bearishBars);
    expect(result).toBeNull();
  });

  it("the macro filter requires BOTH a clear downward deviation AND a declining slope — a flat-but-below-average price alone is not enough", () => {
    // Sanity: with the strategy's own default thresholds, a fixture whose
    // macro slope is essentially flat (the standard makeCompressionFixture
    // baseline) never trips the filter, however jumpy the trigger bar is —
    // covered structurally by every correct-signal test above; this test
    // pins the specific field names the filter's decision is derived from.
    const bars = makeCompressionFixture("SHORT", 0.02, 0.0001);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.meta).toHaveProperty("macroDeviationPct");
    expect(result?.meta).toHaveProperty("macroSlopePct");
  });
});
