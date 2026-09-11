import type { BacktestMetrics } from "./backtest";
import type { WalkForwardResult } from "./walkForward";
import type { StrategyParams } from "./strategy/types";

export type OverfittingRisk = "LOW" | "MEDIUM" | "HIGH";

export interface OverfittingReport {
  risk: OverfittingRisk;
  score: number; // 0-100, higher = more overfit risk
  flags: string[];
}

/**
 * Overfitting Detector (spec §27). Every check here is a reason to raise
 * concern, never a reason to lower it — this module has no "this looks
 * great" path, only "here is what should make you suspicious."
 */
export function detectOverfitting(
  params: StrategyParams,
  baseMetrics: BacktestMetrics,
  walkForward: WalkForwardResult | null
): OverfittingReport {
  const flags: string[] = [];
  let score = 0;

  const paramCount = Object.keys(params).length;
  if (paramCount > 6) {
    flags.push(`Strategy has ${paramCount} free parameters — more degrees of freedom means more ways to fit noise.`);
    score += 15;
  }

  if (baseMetrics.trades < 30) {
    flags.push(`Only ${baseMetrics.trades} trades in the base backtest — too few to distinguish edge from noise.`);
    score += 25;
  }

  if (walkForward && walkForward.windows.length > 0) {
    const degradedWindows = walkForward.windows.filter((w) => w.degraded).length;
    const degradedShare = degradedWindows / walkForward.windows.length;
    if (degradedShare > 0.5) {
      flags.push(`${Math.round(degradedShare * 100)}% of walk-forward windows show out-of-sample performance collapsing versus in-sample.`);
      score += 30;
    }
    const trainReturns = walkForward.windows.map((w) => w.trainMetrics.totalReturnPct);
    const oosReturns = walkForward.windows.map((w) => w.oosMetrics.totalReturnPct);
    const avgTrain = trainReturns.reduce((a, b) => a + b, 0) / trainReturns.length;
    const avgOos = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
    if (avgTrain > 0 && avgOos < avgTrain * 0.4) {
      flags.push(`Average OOS return (${avgOos.toFixed(1)}%) is far below average in-sample return (${avgTrain.toFixed(1)}%).`);
      score += 20;
    }
  } else {
    flags.push("No walk-forward data exists yet — overfitting cannot be ruled out.");
    score += 10;
  }

  if (baseMetrics.profitFactor !== null && baseMetrics.profitFactor > 5) {
    flags.push(`Profit factor of ${baseMetrics.profitFactor.toFixed(1)} is unusually high — verify this isn't driven by one or two outlier trades.`);
    score += 10;
  }

  score = Math.min(100, score);
  const risk: OverfittingRisk = score >= 55 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";

  return { risk, score, flags };
}
