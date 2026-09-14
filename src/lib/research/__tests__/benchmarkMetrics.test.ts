import { describe, expect, it } from "vitest";
import { computeStrategyBenchmarkMetrics } from "../benchmarkMetrics";
import type { ReplayMetrics, ReplayTradeRecord } from "@/lib/replay/types";
import type { BenchmarkEvaluationResult } from "../benchmarkEvaluation";

const BASE_METRICS: ReplayMetrics = {
  totalReturnPct: 10,
  cagrPct: null,
  sharpe: null,
  sortino: null,
  maxDrawdownPct: 5,
  winRate: 0.5,
  trades: 2,
  avgTradeReturnPct: 1,
  profitFactor: 2,
  finalEquity: 22000,
  expectancy: 100,
  avgWinPct: 2,
  avgLossPct: -1,
  exposurePct: 30,
  longestWinStreak: 2,
  longestLossStreak: 1,
  volatilityPct: 10,
  maxExposurePct: 40,
  avgExposurePct: 15,
};

const BASE_EVALUATION: BenchmarkEvaluationResult = {
  status: "PASS",
  targetReachedAt: "2026-04-01T00:00:00Z",
  daysToTarget: 31,
  failedAt: null,
  daysUntilFailure: null,
  failureReason: null,
  dailyStopTriggered: false,
  totalStopTriggered: false,
  maxDailyDrawdownPct: -2,
  finalTotalPnlPct: 10,
};

function trade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "breakout-baseline-v1",
    strategyName: "Breakout Baseline",
    direction: "LONG",
    entryTime: "2026-03-01T00:00:00Z",
    exitTime: "2026-03-01T04:00:00Z",
    entryPrice: 100,
    exitPrice: 103,
    quantity: 1,
    fees: 0.1,
    slippageCost: 0.05,
    grossPnl: 3,
    netPnl: 2.85,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 3,
    decisionIndex: 0,
    stopLoss: 98,
    takeProfit: 103,
    ...overrides,
  };
}

describe("Fase 11 — computeStrategyBenchmarkMetrics: buckets", () => {
  it("passes through Performance/Risk fields straight from ReplayMetrics, and computes totalPnl from initialEquity", () => {
    const result = computeStrategyBenchmarkMetrics(BASE_METRICS, [trade()], BASE_EVALUATION, 20000);
    expect(result.performance.totalReturnPct).toBe(10);
    expect(result.performance.finalEquity).toBe(22000);
    expect(result.performance.totalPnl).toBe(2000);
    expect(result.risk.maxDrawdownPct).toBe(5);
    expect(result.risk.maxExposurePct).toBe(40);
    expect(result.risk.avgExposurePct).toBe(15);
  });

  it("maps the Evaluation bucket straight from BenchmarkEvaluationResult", () => {
    const result = computeStrategyBenchmarkMetrics(BASE_METRICS, [trade()], BASE_EVALUATION, 20000);
    expect(result.evaluation.status).toBe("PASS");
    expect(result.evaluation.targetReached).toBe(true);
    expect(result.evaluation.failed).toBe(false);
    expect(result.risk.maxDailyDrawdownPct).toBe(-2);
  });

  it("computes average RRR from trades that carry stopLoss/takeProfit", () => {
    // RRR = |103-100| / |100-98| = 3/2 = 1.5
    const result = computeStrategyBenchmarkMetrics(BASE_METRICS, [trade()], BASE_EVALUATION, 20000);
    expect(result.execution.avgRrr).toBeCloseTo(1.5, 5);
  });

  it("returns null avgRrr when no trade carries stop/target levels (an older run predating the field)", () => {
    const result = computeStrategyBenchmarkMetrics(BASE_METRICS, [trade({ stopLoss: undefined, takeProfit: undefined })], BASE_EVALUATION, 20000);
    expect(result.execution.avgRrr).toBeNull();
  });

  it("computes average holding time in hours from entryTime/exitTime", () => {
    const result = computeStrategyBenchmarkMetrics(BASE_METRICS, [trade()], BASE_EVALUATION, 20000);
    expect(result.execution.avgHoldingTimeHours).toBeCloseTo(4, 5);
  });

  it("returns null holding time for zero trades", () => {
    const result = computeStrategyBenchmarkMetrics({ ...BASE_METRICS, trades: 0 }, [], BASE_EVALUATION, 20000);
    expect(result.execution.avgHoldingTimeHours).toBeNull();
    expect(result.execution.avgRrr).toBeNull();
  });
});
