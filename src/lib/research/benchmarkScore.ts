import type { ReplayMetrics } from "@/lib/replay/types";
import type { BenchmarkOutcomeStatus } from "./benchmarkEvaluation";

/**
 * Fase 11, spec section 14 — a composite Strategy Score used ONLY to help
 * rank/compare the benchmark's results at a glance. It is NEVER fed back
 * into anything that selects parameters or trains a model (spec section
 * 17: "No permitir que una estrategia con un enorme retorno pero drawdown
 * extremo gane automáticamente" — and, more broadly, this score never
 * drives optimization of any kind).
 *
 * Four equally-documented components, weighted 30/30/20/20:
 *
 *  - profitability (30%): totalReturnPct, clamped to [0, 20]% and scaled to
 *    0-100 — a strategy returning +40% scores the SAME as one returning
 *    +20% on this component (a huge return alone is not allowed to dominate
 *    the score; drawdown/survival below decide the rest).
 *  - drawdown (30%): 100 − min(maxDrawdownPct, 50) × 2 — a maxDrawdownPct
 *    of 0% scores 100, 25% scores 50, 50%+ scores 0. This is the component
 *    that keeps a reckless-but-lucky return from winning outright.
 *  - consistency (20%): the average of (winRate × 100) and a profitFactor
 *    clamped to [0, 3] scaled to 0-100 — rewards a strategy that wins
 *    often AND wins more than it loses, not just one or the other.
 *  - evaluationSurvival (20%): PASS = 100, INCONCLUSIVE = 50, FAIL = 0 —
 *    whether this exact trajectory would have survived a real evaluation
 *    account matters as much as raw return/drawdown numbers.
 *
 * Final score = 0.30×profitability + 0.30×drawdown + 0.20×consistency + 0.20×evaluationSurvival, rounded to 1 decimal, always in [0, 100].
 */
export interface BenchmarkScoreBreakdown {
  score: number;
  profitabilityComponent: number;
  drawdownComponent: number;
  consistencyComponent: number;
  evaluationSurvivalComponent: number;
  formula: string;
}

const EVALUATION_SURVIVAL_SCORE: Record<BenchmarkOutcomeStatus, number> = { PASS: 100, INCONCLUSIVE: 50, FAIL: 0 };

export function computeBenchmarkScore(metrics: ReplayMetrics, evaluationStatus: BenchmarkOutcomeStatus): BenchmarkScoreBreakdown {
  const profitabilityComponent = (Math.max(0, Math.min(metrics.totalReturnPct, 20)) / 20) * 100;
  const drawdownComponent = Math.max(0, 100 - Math.min(metrics.maxDrawdownPct, 50) * 2);
  const winRateComponent = metrics.winRate * 100;
  const profitFactorComponent = (Math.max(0, Math.min(metrics.profitFactor ?? 0, 3)) / 3) * 100;
  const consistencyComponent = (winRateComponent + profitFactorComponent) / 2;
  const evaluationSurvivalComponent = EVALUATION_SURVIVAL_SCORE[evaluationStatus];

  const score = 0.3 * profitabilityComponent + 0.3 * drawdownComponent + 0.2 * consistencyComponent + 0.2 * evaluationSurvivalComponent;

  return {
    score: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10,
    profitabilityComponent: Math.round(profitabilityComponent * 10) / 10,
    drawdownComponent: Math.round(drawdownComponent * 10) / 10,
    consistencyComponent: Math.round(consistencyComponent * 10) / 10,
    evaluationSurvivalComponent,
    formula: "score = 0.30×profitability(totalReturnPct capped at 20%) + 0.30×drawdown(100 - min(maxDrawdownPct,50)×2) + 0.20×consistency(avg of winRate and profitFactor capped at 3) + 0.20×evaluationSurvival(PASS=100, INCONCLUSIVE=50, FAIL=0)",
  };
}
