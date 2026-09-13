import { describe, expect, it } from "vitest";
import { computeReplayMetrics } from "../replayMetrics";
import type { ReplayTradeRecord } from "../types";

function makeTrade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "trend-following",
    strategyName: "Trend Following",
    direction: "LONG",
    entryTime: new Date(0).toISOString(),
    exitTime: new Date(3600_000).toISOString(),
    entryPrice: 100,
    exitPrice: 105,
    quantity: 1,
    fees: 0,
    slippageCost: 0,
    grossPnl: 5,
    netPnl: 5,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 0.05,
    decisionIndex: 0,
    ...overrides,
  };
}

describe("AUDIT: computeReplayMetrics (Fase 7 STEP 3)", () => {
  it("returns valid, non-NaN metrics for an empty run (no trades, no equity movement)", () => {
    const metrics = computeReplayMetrics([{ t: 0, equity: 10000 }], [], 10000, 0);
    expect(metrics.trades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.totalReturnPct).toBe(0);
    expect(Number.isNaN(metrics.avgTradeReturnPct)).toBe(false);
    expect(metrics.profitFactor).toBe(0);
  });

  it("computes win rate, profit factor, and expectancy correctly from a known mix of trades", () => {
    const trades = [
      makeTrade({ netPnl: 100, entryPrice: 100, quantity: 10 }), // win: +10%
      makeTrade({ netPnl: 100, entryPrice: 100, quantity: 10 }), // win: +10%
      makeTrade({ netPnl: -50, entryPrice: 100, quantity: 10 }), // loss: -5%
    ];
    const equityCurve = [
      { t: 0, equity: 10000 },
      { t: 1, equity: 10100 },
      { t: 2, equity: 10200 },
      { t: 3, equity: 10150 },
    ];
    const metrics = computeReplayMetrics(equityCurve, trades, 10000, 50);

    expect(metrics.trades).toBe(3);
    expect(metrics.winRate).toBeCloseTo(2 / 3, 5);
    expect(metrics.profitFactor).toBeCloseTo(200 / 50, 5);
    expect(metrics.expectancy).toBeCloseTo((100 + 100 - 50) / 3, 5);
    expect(metrics.totalReturnPct).toBeCloseTo(1.5, 5);
    expect(metrics.finalEquity).toBe(10150);
    expect(metrics.exposurePct).toBe(50);
  });

  it("computes maxDrawdownPct from the equity curve's own peak-to-trough, independent of trades", () => {
    const equityCurve = [
      { t: 0, equity: 10000 },
      { t: 1, equity: 11000 }, // peak
      { t: 2, equity: 9900 }, // -10% from peak
      { t: 3, equity: 10500 },
    ];
    const metrics = computeReplayMetrics(equityCurve, [], 10000, 0);
    expect(metrics.maxDrawdownPct).toBeCloseTo(10, 5);
  });

  it("tracks the longest winning and losing streaks in trade order", () => {
    const trades = [
      makeTrade({ netPnl: 10 }),
      makeTrade({ netPnl: 10 }),
      makeTrade({ netPnl: 10 }),
      makeTrade({ netPnl: -5 }),
      makeTrade({ netPnl: -5 }),
      makeTrade({ netPnl: 10 }),
    ];
    const metrics = computeReplayMetrics([{ t: 0, equity: 10000 }], trades, 10000, 0);
    expect(metrics.longestWinStreak).toBe(3);
    expect(metrics.longestLossStreak).toBe(2);
  });
});
