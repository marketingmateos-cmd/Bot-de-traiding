import type { OHLCVBar } from "@/lib/providers/types";
import type { StrategyDefinition, StrategyParams } from "./strategy/types";
import { runBacktest } from "./backtest";
import { runWalkForward } from "./walkForward";
import { computeRobustnessScore } from "./robustness";
import { detectOverfitting } from "./overfitting";
import { computeBuyAndHold, compareToBenchmark } from "./benchmark";
import { assessEvidence, type EvidenceLevel } from "./luckVsEdge";

export type HypothesisStatus = "ACCEPTED" | "REJECTED" | "INSUFFICIENT_EVIDENCE";

export interface HypothesisTestResult {
  status: HypothesisStatus;
  evidenceLevel: EvidenceLevel;
  rationale: string;
  metrics: ReturnType<typeof runBacktest>["metrics"];
  benchmarkComparison: ReturnType<typeof compareToBenchmark>;
  robustnessScore: number;
  overfittingRisk: string;
}

/**
 * Hypothesis Engine (spec §30): HYPOTHESIS -> EXPERIMENT -> BACKTEST -> OOS
 * -> ROBUSTNESS -> RESULT -> ACCEPT/REJECT, run as one pipeline. A
 * hypothesis is only ever ACCEPTED when it beats its benchmark, its
 * out-of-sample windows hold up, and its evidence level is not LOW — never
 * from the base backtest's headline return alone.
 */
export function testHypothesis(bars: OHLCVBar[], strategy: StrategyDefinition, params: StrategyParams): HypothesisTestResult {
  const backtestResult = runBacktest(bars, strategy, params);
  const walkForward = runWalkForward(bars, strategy, params);
  const benchmark = computeBuyAndHold(bars);
  const comparison = compareToBenchmark(backtestResult.metrics, benchmark);
  const overfitting = detectOverfitting(params, backtestResult.metrics, walkForward);
  const robustness = computeRobustnessScore({
    baseMetrics: backtestResult.metrics,
    walkForward,
    parameterPerturbationReturns: [],
    crossAssetReturns: [],
    costSensitivityReturns: [],
  });

  const statsLike = {
    trades: backtestResult.metrics.trades,
    winRate: backtestResult.metrics.winRate,
    avgReturnPct: backtestResult.metrics.avgTradeReturnPct,
    sharpe: backtestResult.metrics.sharpe,
    sortino: backtestResult.metrics.sortino,
    maxDrawdownPct: backtestResult.metrics.maxDrawdownPct,
    totalNetPnl: backtestResult.metrics.finalEquity - 100,
    profitFactor: backtestResult.metrics.profitFactor,
  };
  const evidence = assessEvidence(statsLike, {
    robustnessScore: robustness.score,
    oosMetrics: { sharpe: walkForward.aggregateOosMetrics.avgSharpe },
    benchmarkBeat: comparison.strategyBeatsReturn,
  });

  let status: HypothesisStatus = "INSUFFICIENT_EVIDENCE";
  let rationale = "Evidence level is LOW — not enough trades or walk-forward history to accept or reject this hypothesis yet.";

  if (evidence.evidenceLevel !== "LOW") {
    if (comparison.strategyBeatsReturn && walkForward.aggregateOosMetrics.winRateOfWindows >= 0.5 && overfitting.risk !== "HIGH") {
      status = "ACCEPTED";
      rationale = `Beats Buy & Hold by ${comparison.returnGapPct.toFixed(1)}pp, ${(walkForward.aggregateOosMetrics.winRateOfWindows * 100).toFixed(0)}% of OOS windows profitable, overfitting risk ${overfitting.risk}.`;
    } else {
      status = "REJECTED";
      rationale = !comparison.strategyBeatsReturn
        ? "Underperforms simple Buy & Hold over the tested period."
        : overfitting.risk === "HIGH"
        ? "Overfitting risk is HIGH — the backtest result is not trustworthy as-is."
        : "Out-of-sample windows do not confirm the in-sample edge.";
    }
  }

  return {
    status,
    evidenceLevel: evidence.evidenceLevel,
    rationale,
    metrics: backtestResult.metrics,
    benchmarkComparison: comparison,
    robustnessScore: robustness.score,
    overfittingRisk: overfitting.risk,
  };
}
