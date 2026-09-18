import { describe, expect, it } from "vitest";
import { momentumBreakoutFtmoV2Strategy } from "../momentumBreakoutFtmoV2";
import { runBacktest } from "@/lib/engines/backtest";
import type { OHLCVBar } from "@/lib/providers/types";
import type { FeatureSnapshot } from "@/lib/engines/features";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";

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

const { volatilityPeriod, compressionLookback, baselinePeriod, circuitBreakerThreshold, circuitBreakerScaleFactor } =
  momentumBreakoutFtmoV2Strategy.defaultParams as {
    volatilityPeriod: number;
    compressionLookback: number;
    baselinePeriod: number;
    circuitBreakerThreshold: number;
    circuitBreakerScaleFactor: number;
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

// Same fixture builder as v1's test suite — compression + high-energy
// breakout — reused unmodified since the entry conditions (compression,
// energy trigger, real range breakout) are IDENTICAL between v1 and v2.
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

function evaluate(bars: OHLCVBar[], consecutiveLosses?: number) {
  return momentumBreakoutFtmoV2Strategy.evaluate(
    bars,
    DUMMY_FEATURES,
    momentumBreakoutFtmoV2Strategy.defaultParams,
    "TRANSITION",
    consecutiveLosses === undefined ? undefined : { consecutiveLosses }
  );
}

describe("MomentumBreakoutFtmoV2Strategy — core entry logic preserved from v1", () => {
  it("fires LONG when a high-energy bullish candle breaks out of a genuine compression phase", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });

  it("still discards a breakout that was NOT actually compressed beforehand", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.006, 0.006);
    expect(evaluate(bars)).toBeNull();
  });

  it("still discards a breakout whose body is too small (< 1.5x ATR)", () => {
    const bars = makeCompressionFixture("LONG", 0.0008, 0.0001);
    expect(evaluate(bars)).toBeNull();
  });

  it("still returns null on insufficient history", () => {
    const tooFew = makeCompressionFixture("LONG", 0.02, 0.0001).slice(-40);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("MomentumBreakoutFtmoV2Strategy — circuit breaker threshold (new in v2)", () => {
  it("keeps riskScaleFactor at 1 (no reduction) when there is no consecutive-loss context", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars); // no context passed at all
    expect(result).not.toBeNull();
    expect(result?.riskScaleFactor).toBe(1);
    expect(result?.meta?.riskScaleFactor).toBe(1);
    expect(result?.reason).not.toContain("Circuit breaker ACTIVO");
  });

  it("keeps riskScaleFactor at 1 below the threshold (2 consecutive losses, threshold is 3)", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars, circuitBreakerThreshold - 1);
    expect(result).not.toBeNull();
    expect(result?.riskScaleFactor).toBe(1);
    expect(result?.reason).not.toContain("Circuit breaker ACTIVO");
  });

  it("scales riskScaleFactor down to circuitBreakerScaleFactor exactly AT the threshold (3 consecutive losses)", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars, circuitBreakerThreshold);
    expect(result).not.toBeNull();
    expect(result?.riskScaleFactor).toBe(circuitBreakerScaleFactor);
    expect(result?.meta?.riskScaleFactor).toBe(circuitBreakerScaleFactor);
    expect(result?.meta?.consecutiveLosses).toBe(circuitBreakerThreshold);
    expect(result?.reason).toContain("Circuit breaker ACTIVO");
  });

  it("stays at circuitBreakerScaleFactor (does not escalate further) well above the threshold", () => {
    const bars = makeCompressionFixture("LONG", 0.02, 0.0001);
    const result = evaluate(bars, 10);
    expect(result).not.toBeNull();
    expect(result?.riskScaleFactor).toBe(circuitBreakerScaleFactor);
  });

  it("applies the same circuit breaker to SHORT signals", () => {
    const bars = makeCompressionFixture("SHORT", 0.02, 0.0001);
    const result = evaluate(bars, circuitBreakerThreshold);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.riskScaleFactor).toBe(circuitBreakerScaleFactor);
  });
});

describe("MomentumBreakoutFtmoV2Strategy — end-to-end engine wiring (backtest.ts actually halves the position size)", () => {
  it("opens a materially smaller position on the 4th trade, right after 3 consecutive losses, than the equity-adjusted unscaled size would be", () => {
    // A minimal synthetic strategy — deliberately NOT Candidata D's own
    // compression/energy logic (which is hard to trigger repeatedly on
    // demand) — that always fires LONG and sets riskScaleFactor exactly the
    // way momentumBreakoutFtmoV2Strategy does, so this test proves the
    // ENGINE wiring (backtest.ts computing consecutiveLosses from its own
    // real closed trades, then applying riskScaleFactor to sizing) works
    // end-to-end, not just that the strategy's own meta field looks right.
    const testStrategy: StrategyDefinition = {
      id: "test-circuit-breaker-wiring",
      kind: "MOMENTUM",
      name: "Test Circuit Breaker Wiring",
      version: "1.0",
      defaultParams: {},
      timeframe: "H1",
      recommendedRegimes: [], // always compatible, see regime.ts's isRegimeCompatible
      defaultStopLossPct: 2,
      defaultTakeProfitPct: 50, // wide enough to never fire on a monotonically declining series
      defaultTrailingStopPct: null,
      costModel: { feeBps: 10, slippageBps: 5 },
      evaluate(_bars, _features, _params, _regime, context) {
        const consecutiveLosses = context?.consecutiveLosses ?? 0;
        const riskScaleFactor = consecutiveLosses >= 3 ? 0.5 : 1;
        return { kind: "MOMENTUM", direction: "LONG", strength: 0.5, reason: "test signal", riskScaleFactor };
      },
    };

    // Steady ~3% per-bar decline — comfortably larger than the 2% stop, so
    // every LONG entry gets stopped out on the very next bar, producing a
    // clean, deterministic string of losing trades regardless of the
    // small (seeded but non-trivial-to-predict) slippage/spread simulateFill
    // applies.
    const now = Date.now();
    const stepMs = 3_600_000;
    const count = 160;
    let price = 1000;
    const bars: OHLCVBar[] = Array.from({ length: count }, (_, i) => {
      const open = price;
      price = price * 0.97;
      const close = price;
      return { timestamp: new Date(now - (count - i) * stepMs), open, high: open * 1.001, low: close * 0.999, close, volume: 1000 };
    });

    const output = runBacktest(bars, testStrategy, testStrategy.defaultParams, { initialEquity: 100 });
    expect(output.trades.length).toBeGreaterThanOrEqual(4);
    // First three trades must indeed be losses — otherwise this fixture
    // doesn't actually exercise the circuit breaker and the test proves
    // nothing.
    expect(output.trades[0].netPnl).toBeLessThanOrEqual(0);
    expect(output.trades[1].netPnl).toBeLessThanOrEqual(0);
    expect(output.trades[2].netPnl).toBeLessThanOrEqual(0);

    // The equity effect of each trade is its netPnl (exit-side) MINUS the
    // entry fee charged when it opened — `BacktestTradeRecord.fees` only
    // records the EXIT fee, so the entry fee (charged directly against
    // equity in `backtest.ts`, never folded into `netPnl`) is recomputed
    // here from the recorded quantity/entryPrice/costModel.
    const feeBps = testStrategy.costModel.feeBps;
    const entryFeeOf = (t: (typeof output.trades)[number]) => t.quantity * t.entryPrice * (feeBps / 10000);

    const stopDistancePct = testStrategy.defaultStopLossPct / 100;
    const equityBeforeTrade1 = 100;
    const equityBeforeTrade4 = 100 + output.trades.slice(0, 3).reduce((s, t) => s + t.netPnl - entryFeeOf(t), 0);

    const perUnitRisk1 = output.trades[0].entryPrice * stopDistancePct;
    const perUnitRisk4 = output.trades[3].entryPrice * stopDistancePct;

    // Trade #1 (0 prior losses) must be sized at the FULL 1% risk.
    const expectedQuantity1 = (equityBeforeTrade1 * 0.01) / perUnitRisk1;
    expect(output.trades[0].quantity).toBeCloseTo(expectedQuantity1, 6);

    // Trade #4 (3 consecutive losses immediately before it) must be sized
    // at exactly HALF the risk, computed from the REAL equity at that point
    // (which already reflects the 3 prior losses) — not a guessed number.
    const expectedScaledQuantity4 = (equityBeforeTrade4 * 0.005) / perUnitRisk4;
    const expectedUnscaledQuantity4 = (equityBeforeTrade4 * 0.01) / perUnitRisk4;
    expect(output.trades[3].quantity).toBeCloseTo(expectedScaledQuantity4, 6);
    expect(output.trades[3].quantity).toBeCloseTo(expectedUnscaledQuantity4 * 0.5, 6);
    expect(output.trades[3].quantity).toBeLessThan(expectedUnscaledQuantity4);
  });

  it("resets the circuit breaker back to full size after a winning trade", () => {
    // Same wiring-proof strategy, but this time the price series has one
    // deliberate up-spike right after the 3rd loss so that specific trade
    // wins (hits the wide take-profit instead of the stop), then resumes
    // declining — the NEXT trade after that win must be back at full size.
    const testStrategy: StrategyDefinition = {
      id: "test-circuit-breaker-reset",
      kind: "MOMENTUM",
      name: "Test Circuit Breaker Reset",
      version: "1.0",
      defaultParams: {},
      timeframe: "H1",
      recommendedRegimes: [],
      defaultStopLossPct: 2,
      defaultTakeProfitPct: 5,
      defaultTrailingStopPct: null,
      costModel: { feeBps: 10, slippageBps: 5 },
      evaluate(_bars, _features, _params, _regime, context) {
        const consecutiveLosses = context?.consecutiveLosses ?? 0;
        const riskScaleFactor = consecutiveLosses >= 3 ? 0.5 : 1;
        return { kind: "MOMENTUM", direction: "LONG", strength: 0.5, reason: "test signal", riskScaleFactor };
      },
    };

    const now = Date.now();
    const stepMs = 3_600_000;
    // 60 FLAT warmup bars first (runBacktest only starts evaluating at
    // WARMUP_BARS=60 — without this, the legs below would be entirely
    // consumed by warmup and never actually traded), THEN: 3 decline legs
    // (guaranteed stop-outs) of 6 bars each, one strong rally leg
    // (guaranteed take-profit hit), then decline resumes.
    const legs: { count: number; drift: number }[] = [
      { count: 60, drift: 0 },
      { count: 6, drift: -0.03 },
      { count: 6, drift: -0.03 },
      { count: 6, drift: -0.03 },
      { count: 6, drift: 0.08 },
      { count: 40, drift: -0.03 },
    ];
    let price = 1000;
    const closes: number[] = [];
    for (const leg of legs) {
      for (let i = 0; i < leg.count; i++) {
        price = price * (1 + leg.drift);
        closes.push(price);
      }
    }
    const total = closes.length;
    const bars: OHLCVBar[] = closes.map((close, i) => {
      const open = i === 0 ? 1000 : closes[i - 1];
      return {
        timestamp: new Date(now - (total - i) * stepMs),
        open,
        high: Math.max(open, close) * 1.001,
        low: Math.min(open, close) * 0.999,
        close,
        volume: 1000,
      };
    });

    const output = runBacktest(bars, testStrategy, testStrategy.defaultParams, { initialEquity: 100 });
    // The exact bar-by-bar trade cadence (roughly 2 bars/trade: fill, then
    // checked for a stop the very next bar) isn't something to hardcode
    // indices against — instead, find the first WIN wherever it actually
    // falls (the rally leg guarantees at least one) and assert the very
    // NEXT trade after it is priced at FULL (unscaled) risk, proving the
    // circuit breaker resets on a win regardless of how many losses came
    // before it.
    const firstWinIndex = output.trades.findIndex((t) => t.netPnl > 0);
    expect(firstWinIndex).toBeGreaterThan(0); // at least one loss happened first
    expect(firstWinIndex + 1).toBeLessThan(output.trades.length); // there IS a trade after the win

    const feeBps = testStrategy.costModel.feeBps;
    const entryFeeOf = (t: (typeof output.trades)[number]) => t.quantity * t.entryPrice * (feeBps / 10000);
    const stopDistancePct = testStrategy.defaultStopLossPct / 100;

    const tradesBeforeNext = output.trades.slice(0, firstWinIndex + 1);
    const equityBeforeNextTrade = 100 + tradesBeforeNext.reduce((s, t) => s + t.netPnl - entryFeeOf(t), 0);
    const nextTrade = output.trades[firstWinIndex + 1];
    const perUnitRiskNext = nextTrade.entryPrice * stopDistancePct;

    // The trade right after a win must be at full 1% risk, not the
    // scaled-down 0.5% — the circuit breaker resets on any win.
    const expectedFullQuantity = (equityBeforeNextTrade * 0.01) / perUnitRiskNext;
    expect(nextTrade.quantity).toBeCloseTo(expectedFullQuantity, 6);
  });
});
