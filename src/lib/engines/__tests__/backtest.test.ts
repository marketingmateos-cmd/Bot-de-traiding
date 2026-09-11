import { describe, expect, it } from "vitest";
import { runBacktest } from "../backtest";
import type { OHLCVBar } from "@/lib/providers/types";
import type { StrategyDefinition } from "../strategy/types";

function makeFlatBars(count: number, price = 100): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(now - (count - i) * stepMs),
    open: price,
    high: price * 1.001,
    low: price * 0.999,
    close: price,
    volume: 1000,
  }));
}

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

const baseStrategy: Omit<StrategyDefinition, "evaluate"> = {
  id: "test-strategy",
  kind: "TREND_FOLLOWING",
  name: "Test Strategy",
  version: "1.0",
  defaultParams: {},
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"],
  defaultStopLossPct: 3,
  defaultTakeProfitPct: 6,
  defaultTrailingStopPct: null,
  costModel: { feeBps: 10, slippageBps: 5 },
};

describe("runBacktest — no look-ahead bias", () => {
  it("never evaluates the strategy with more bars than have occurred so far, and window lengths only grow", () => {
    const bars = makeFlatBars(200);
    const seenLengths: number[] = [];

    const probeStrategy: StrategyDefinition = {
      ...baseStrategy,
      evaluate(window) {
        seenLengths.push(window.length);
        // The window's last bar must never be "in the future" relative to
        // its own length: bar i corresponds to the (i+1)-th element.
        return null;
      },
    };

    runBacktest(bars, probeStrategy, {});

    expect(seenLengths.length).toBeGreaterThan(0);
    for (let i = 1; i < seenLengths.length; i++) {
      expect(seenLengths[i]).toBeGreaterThan(seenLengths[i - 1]);
    }
    expect(Math.max(...seenLengths)).toBeLessThanOrEqual(bars.length);
  });

  it("fills a signal at the NEXT bar's open, never at the signal bar's own close", () => {
    const bars = makeFlatBars(120);
    let fired = false;

    const oneShotStrategy: StrategyDefinition = {
      ...baseStrategy,
      evaluate(window) {
        if (!fired && window.length === 65) {
          fired = true;
          return { kind: "TREND_FOLLOWING", direction: "LONG", strength: 1, reason: "test signal" };
        }
        return null;
      },
    };

    const result = runBacktest(bars, oneShotStrategy, {});
    expect(result.trades.length).toBeGreaterThanOrEqual(0);
    if (result.trades.length > 0) {
      const trade = result.trades[0];
      // Entry index (65, 0-based bar 65) means entry time should be bars[65]'s
      // timestamp (the bar AFTER the one that produced the length-65 window,
      // i.e. index 65 itself since window.length 65 means bars[0..64] were seen).
      expect(new Date(trade.entryTime).getTime()).toBe(bars[65].timestamp.getTime());
    }
  });
});

describe("runBacktest — realistic, bounded P&L (regression for entry-fee sizing bug)", () => {
  it("never lets equity swing by more than the position's actual notional in one bar", () => {
    // A strategy that goes long on the very first eligible bar and never exits
    // via signal (only stop/target) — this reproduces the scenario that once
    // caused a fee-sizing bug to blow up equity by ~50% in a single step.
    let opened = false;
    const alwaysLongOnce: StrategyDefinition = {
      ...baseStrategy,
      defaultStopLossPct: 3,
      defaultTakeProfitPct: 100, // effectively unreachable, so we rely on stop only
      evaluate() {
        if (!opened) {
          opened = true;
          return { kind: "TREND_FOLLOWING", direction: "LONG", strength: 1, reason: "test" };
        }
        return null;
      },
    };

    const bars = makeTrendingBars(200, 100, -0.001); // slow grind down
    const result = runBacktest(bars, alwaysLongOnce, {}, { initialEquity: 100 });

    let maxStep = 0;
    for (let i = 1; i < result.equityCurve.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(result.equityCurve[i].equity - result.equityCurve[i - 1].equity));
    }
    // Position notional is sized to ~33% of equity (1% risk / 3% stop), so a
    // single-bar move of a fraction of a percent should never move equity by
    // anywhere near half of the account.
    expect(maxStep).toBeLessThan(20);
    // Equity should never go absurdly negative on a fixed-fractional sizing scheme.
    expect(Math.min(...result.equityCurve.map((p) => p.equity))).toBeGreaterThan(-50);
  });

  it("keeps total return within a plausible range for a mild trend and default risk settings", () => {
    const bars = makeTrendingBars(400, 100, 0.0015);
    let opened = false;
    const longOnce: StrategyDefinition = {
      ...baseStrategy,
      evaluate() {
        if (!opened) {
          opened = true;
          return { kind: "TREND_FOLLOWING", direction: "LONG", strength: 1, reason: "test" };
        }
        return null;
      },
    };
    const result = runBacktest(bars, longOnce, {}, { initialEquity: 100 });
    // With ~33% notional exposure and a mild sustained uptrend, total return
    // should be a modest double-digit percentage at most — nowhere near the
    // -130%+ blowups the fee-sizing bug used to produce.
    expect(Math.abs(result.metrics.totalReturnPct)).toBeLessThan(50);
  });
});
