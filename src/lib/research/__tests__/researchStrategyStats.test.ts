import { describe, expect, it } from "vitest";
import { computeDescriptiveResearchStats } from "../researchStrategyStats";
import type { ReplayTradeRecord, ReplayDecisionRecord } from "@/lib/replay/types";

function trade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "s1",
    strategyName: "S1",
    direction: "LONG",
    entryTime: "2026-01-01T00:00:00.000Z",
    exitTime: "2026-01-01T01:00:00.000Z",
    entryPrice: 100,
    exitPrice: 105,
    quantity: 1,
    fees: 1,
    slippageCost: 0.5,
    grossPnl: 5,
    netPnl: 4,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 5,
    decisionIndex: 0,
    stopLoss: 95,
    takeProfit: 105,
    ...overrides,
  };
}

function decision(overrides: Partial<ReplayDecisionRecord> = {}): ReplayDecisionRecord {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    asset: "BTC",
    availability: { marketData: "REAL", news: "REAL", sentiment: "REAL", onChain: "REAL", ai: "DETERMINISTIC_SYNTHETIC" },
    regime: "NEUTRAL",
    strategyId: "s1",
    strategyName: "S1",
    signal: { direction: "LONG", strength: 0.5, reason: "x" },
    aiAnalyst: null,
    aiCritic: null,
    tradeGateVerdict: "APPROVED",
    tradeGateBlockedBy: null,
    tradeGateSteps: null,
    riskPassed: true,
    riskViolations: null,
    evidenceLevel: null,
    decision: "OPENED",
    positionSize: 1,
    entryPrice: 100,
    reason: "x",
    ...overrides,
  };
}

describe("computeDescriptiveResearchStats", () => {
  it("computes avgR/medianR from realized P&L vs. each trade's own stop distance", () => {
    const trades = [
      trade({ direction: "LONG", entryPrice: 100, exitPrice: 105, stopLoss: 95 }), // R = 5/5 = 1
      trade({ direction: "LONG", entryPrice: 100, exitPrice: 90, stopLoss: 95 }), // R = -10/5 = -2
      trade({ direction: "SHORT", entryPrice: 100, exitPrice: 94, stopLoss: 105 }), // R = 6/5 = 1.2
    ];
    const stats = computeDescriptiveResearchStats(trades, []);
    expect(stats.avgR).toBeCloseTo((1 + -2 + 1.2) / 3, 6);
    expect(stats.medianR).toBeCloseTo(1, 6); // sorted: -2, 1, 1.2 -> median 1
  });

  it("counts long/short distribution and total fees/slippage", () => {
    const trades = [trade({ direction: "LONG", fees: 1, slippageCost: 0.5 }), trade({ direction: "SHORT", fees: 2, slippageCost: 1 }), trade({ direction: "LONG", fees: 1.5, slippageCost: 0.25 })];
    const stats = computeDescriptiveResearchStats(trades, []);
    expect(stats.longCount).toBe(2);
    expect(stats.shortCount).toBe(1);
    expect(stats.totalFees).toBeCloseTo(4.5, 6);
    expect(stats.totalSlippage).toBeCloseTo(1.75, 6);
  });

  it("numSignals reflects the decisions array length (every decision is already a fired signal)", () => {
    const decisions = [decision(), decision(), decision()];
    const stats = computeDescriptiveResearchStats([], decisions);
    expect(stats.numSignals).toBe(3);
    expect(stats.numTrades).toBe(0);
  });

  it("returns null avgR/medianR (never NaN/0) when no trade has a recorded stop", () => {
    const trades = [trade({ stopLoss: null }), trade({ stopLoss: undefined })];
    const stats = computeDescriptiveResearchStats(trades, []);
    expect(stats.avgR).toBeNull();
    expect(stats.medianR).toBeNull();
  });

  it("handles an empty trade/decision set without throwing", () => {
    const stats = computeDescriptiveResearchStats([], []);
    expect(stats).toEqual({ numSignals: 0, numTrades: 0, longCount: 0, shortCount: 0, avgR: null, medianR: null, totalFees: 0, totalSlippage: 0 });
  });
});
