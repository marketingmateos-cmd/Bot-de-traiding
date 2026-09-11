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
    warnings.push(`Solo ${stats.trades} operación(es) registrada(s) — muestra demasiado pequeña para sacar conclusiones (se necesitan ${MIN_TRADES_MEDIUM}+ para una confianza moderada).`);
  }
  if (stats.winRate > 0.7 && stats.trades < 50) {
    warnings.push(`Una tasa de acierto del ${(stats.winRate * 100).toFixed(0)}% en ${stats.trades} operaciones es más propia de una racha de suerte que de una ventaja duradera.`);
  }
  if (stats.maxDrawdownPct > 25) {
    warnings.push(`El drawdown máximo del ${stats.maxDrawdownPct.toFixed(1)}% es severo; un retorno llamativo puede ocultar un riesgo de ruina inaceptable.`);
  }
  if (stats.sharpe !== null && stats.sharpe < 0.5) {
    warnings.push(`El ratio de Sharpe (${stats.sharpe.toFixed(2)}) es débil aunque el retorno total parezca positivo.`);
  }
  if (options?.benchmarkBeat === false) {
    warnings.push("La estrategia rinde peor que un simple Buy & Hold en el mismo periodo.");
  }
  if (options?.oosMetrics === undefined || options?.oosMetrics === null) {
    warnings.push("Todavía no existen resultados fuera de muestra (out-of-sample) para esta versión de estrategia.");
  } else if ((options.oosMetrics.sharpe ?? -1) < 0) {
    warnings.push("El ratio de Sharpe fuera de muestra es negativo — el rendimiento dentro de muestra no se generalizó.");
  }
  if (options?.robustnessScore !== undefined && options?.robustnessScore !== null && options.robustnessScore < 50) {
    warnings.push(`La puntuación de robustez (${options.robustnessScore}/100) está por debajo del umbral considerado fiable.`);
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
