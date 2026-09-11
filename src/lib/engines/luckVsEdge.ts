import type { StrategyPerformanceStats } from "./strategyStats";

export type EvidenceLevel = "LOW" | "MEDIUM" | "HIGH";
export type ProveItVerdict = "INSUFFICIENT_EVIDENCE" | "PROMISING" | "ROBUST";

export interface LuckVsEdgeAssessment {
  evidenceLevel: EvidenceLevel;
  verdict: ProveItVerdict;
  warnings: string[];
  sampleSizeOk: boolean;
  minTradesForConfidence: number;
}

const MIN_TRADES_MEDIUM = 30;
const MIN_TRADES_HIGH = 100;

/**
 * Luck vs Edge detector (spec §34) + "Prove It" verdicts (spec §57). This is
 * the module directly implementing lesson #1 and #8 from the Adrián Sáenz
 * postmortem (spec §56): a short winning streak or a high headline return is
 * never, by itself, evidence of an edge. Every check here can only downgrade
 * confidence — nothing here can manufacture confidence from a small sample.
 */
export function assessEvidence(
  stats: StrategyPerformanceStats,
  options?: { robustnessScore?: number | null; oosMetrics?: { sharpe: number | null } | null; benchmarkBeat?: boolean | null }
): LuckVsEdgeAssessment {
  const warnings: string[] = [];

  if (stats.trades < MIN_TRADES_MEDIUM) {
    warnings.push(`Only ${stats.trades} trade(s) recorded — far too small a sample to draw conclusions (need ${MIN_TRADES_MEDIUM}+ for even moderate confidence).`);
  }
  if (stats.winRate > 0.7 && stats.trades < 50) {
    warnings.push(`A ${(stats.winRate * 100).toFixed(0)}% win rate on ${stats.trades} trades is more consistent with a lucky streak than a durable edge.`);
  }
  if (stats.maxDrawdownPct > 25) {
    warnings.push(`Max drawdown of ${stats.maxDrawdownPct.toFixed(1)}% is severe; headline returns can hide unacceptable risk of ruin.`);
  }
  if (stats.sharpe !== null && stats.sharpe < 0.5) {
    warnings.push(`Sharpe ratio (${stats.sharpe.toFixed(2)}) is weak even if total return looks positive.`);
  }
  if (options?.benchmarkBeat === false) {
    warnings.push("Strategy underperforms simple Buy & Hold over the same period.");
  }
  if (options?.oosMetrics === undefined || options?.oosMetrics === null) {
    warnings.push("No out-of-sample results exist yet for this strategy version.");
  } else if ((options.oosMetrics.sharpe ?? -1) < 0) {
    warnings.push("Out-of-sample Sharpe ratio is negative — in-sample performance did not generalize.");
  }
  if (options?.robustnessScore !== undefined && options?.robustnessScore !== null && options.robustnessScore < 50) {
    warnings.push(`Robustness score (${options.robustnessScore}/100) is below the threshold considered reliable.`);
  }

  const sampleSizeOk = stats.trades >= MIN_TRADES_MEDIUM;

  let evidenceLevel: EvidenceLevel = "LOW";
  if (stats.trades >= MIN_TRADES_HIGH && warnings.length <= 1) evidenceLevel = "HIGH";
  else if (stats.trades >= MIN_TRADES_MEDIUM && warnings.length <= 2) evidenceLevel = "MEDIUM";

  let verdict: ProveItVerdict = "INSUFFICIENT_EVIDENCE";
  if (evidenceLevel === "HIGH" && (options?.robustnessScore ?? 0) >= 60 && options?.benchmarkBeat !== false) {
    verdict = "ROBUST";
  } else if (evidenceLevel !== "LOW" && stats.totalNetPnl > 0) {
    verdict = "PROMISING";
  }

  return { evidenceLevel, verdict, warnings, sampleSizeOk, minTradesForConfidence: MIN_TRADES_MEDIUM };
}
