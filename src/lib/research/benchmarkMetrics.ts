import type { ReplayMetrics, ReplayTradeRecord } from "@/lib/replay/types";
import type { BenchmarkEvaluationResult } from "./benchmarkEvaluation";

/**
 * Fase 11, spec section 11 — the full metrics bundle for one strategy's
 * benchmark result, grouped exactly as the spec buckets them. Performance/
 * Risk mostly pass through the existing `ReplayMetrics` (never recomputed
 * here); Evaluation comes straight from `BenchmarkEvaluationResult`;
 * Execution adds the two figures neither of those already carries
 * (average RRR, average holding time) by reading `ReplayTradeRecord[]`.
 */
export interface StrategyBenchmarkMetrics {
  performance: {
    totalReturnPct: number;
    finalEquity: number;
    totalPnl: number;
    profitFactor: number | null;
    expectancy: number;
    winRate: number;
  };
  risk: {
    maxDrawdownPct: number;
    maxDailyDrawdownPct: number;
    maxExposurePct: number | null;
    avgExposurePct: number | null;
    longestWinStreak: number;
    longestLossStreak: number;
  };
  evaluation: {
    status: BenchmarkEvaluationResult["status"];
    targetReached: boolean;
    failed: boolean;
    failureReason: string | null;
    daysToTarget: number | null;
    daysUntilFailure: number | null;
    dailyStopTriggered: boolean;
    totalStopTriggered: boolean;
  };
  execution: {
    trades: number;
    avgTrade: number;
    avgRrr: number | null;
    avgHoldingTimeHours: number | null;
  };
}

function computeAvgRrr(trades: ReplayTradeRecord[]): number | null {
  const withLevels = trades.filter((t) => t.stopLoss !== null && t.stopLoss !== undefined && t.takeProfit !== null && t.takeProfit !== undefined);
  if (withLevels.length === 0) return null;
  const rrrs = withLevels
    .map((t) => {
      const riskDistance = Math.abs(t.entryPrice - (t.stopLoss as number));
      const rewardDistance = Math.abs((t.takeProfit as number) - t.entryPrice);
      return riskDistance > 0 ? rewardDistance / riskDistance : null;
    })
    .filter((v): v is number => v !== null);
  if (rrrs.length === 0) return null;
  return rrrs.reduce((a, b) => a + b, 0) / rrrs.length;
}

function computeAvgHoldingTimeHours(trades: ReplayTradeRecord[]): number | null {
  if (trades.length === 0) return null;
  const totalHours = trades.reduce((s, t) => s + (new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 3_600_000, 0);
  return totalHours / trades.length;
}

export function computeStrategyBenchmarkMetrics(metrics: ReplayMetrics, trades: ReplayTradeRecord[], evaluation: BenchmarkEvaluationResult, initialEquity: number): StrategyBenchmarkMetrics {
  return {
    performance: {
      totalReturnPct: metrics.totalReturnPct,
      finalEquity: metrics.finalEquity,
      totalPnl: metrics.finalEquity - initialEquity,
      profitFactor: metrics.profitFactor,
      expectancy: metrics.expectancy,
      winRate: metrics.winRate,
    },
    risk: {
      maxDrawdownPct: metrics.maxDrawdownPct,
      maxDailyDrawdownPct: evaluation.maxDailyDrawdownPct,
      maxExposurePct: metrics.maxExposurePct ?? null,
      avgExposurePct: metrics.avgExposurePct ?? null,
      longestWinStreak: metrics.longestWinStreak,
      longestLossStreak: metrics.longestLossStreak,
    },
    evaluation: {
      status: evaluation.status,
      targetReached: evaluation.status === "PASS",
      failed: evaluation.status === "FAIL",
      failureReason: evaluation.failureReason,
      daysToTarget: evaluation.daysToTarget,
      daysUntilFailure: evaluation.daysUntilFailure,
      dailyStopTriggered: evaluation.dailyStopTriggered,
      totalStopTriggered: evaluation.totalStopTriggered,
    },
    execution: {
      trades: metrics.trades,
      avgTrade: metrics.expectancy,
      avgRrr: computeAvgRrr(trades),
      avgHoldingTimeHours: computeAvgHoldingTimeHours(trades),
    },
  };
}
