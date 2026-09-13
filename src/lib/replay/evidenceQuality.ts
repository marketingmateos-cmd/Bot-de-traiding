import type { OverfittingReport } from "@/lib/engines/overfitting";
import type { RobustnessClassification } from "./replayRobustness";
import type { EvidenceQualityReport, ReplayDataQualityReport, ReplayDecisionRecord, ReplayMetrics } from "./types";

const MIN_TRADES_MEDIUM = 30;
const MIN_TRADES_HIGH = 100;
const MIN_COVERAGE_PCT = 50;

/**
 * Fase 8 "EVIDENCE QUALITY" panel — the honest final verdict on a replay
 * run. Deliberately takes NO profitability figure as input at all (spec:
 * "Este resultado NO debe depender únicamente de rentabilidad" — this goes
 * further and doesn't depend on it in any amount): a spectacular return on
 * 12 trades with no out-of-sample run and a FRAGILE robustness verdict is
 * INSUFFICIENT_EVIDENCE regardless of how good the equity curve looks, and
 * a mediocre or even negative return backed by 200 trades, a real OOS
 * segment, and a ROBUST classification is real (if unflattering) evidence.
 */
export function computeEvidenceQuality(input: {
  dataQuality: ReplayDataQualityReport;
  metrics: ReplayMetrics;
  decisions: ReplayDecisionRecord[];
  robustness: RobustnessClassification | null;
  robustnessScore: number | null;
  overfitting: OverfittingReport | null;
  hasOos: boolean;
  oosTrades: number;
}): EvidenceQualityReport {
  const factors: string[] = [];
  const sampleSize = input.metrics.trades;
  const aiEvaluated = input.decisions.filter((d) => d.availability.ai !== "UNAVAILABLE");
  const aiAvailabilityPct = input.decisions.length > 0 ? (aiEvaluated.length / input.decisions.length) * 100 : 0;
  const oosQualityScore = input.hasOos ? Math.min(100, (input.oosTrades / MIN_TRADES_MEDIUM) * 100) : null;

  if (sampleSize < MIN_TRADES_MEDIUM) {
    factors.push(`Solo ${sampleSize} operación(es) — se necesitan ${MIN_TRADES_MEDIUM}+ para cualquier conclusión.`);
  }
  if (input.dataQuality.coveragePct < MIN_COVERAGE_PCT) {
    factors.push(`Cobertura de datos del ${input.dataQuality.coveragePct.toFixed(1)}% — insuficiente para confiar en el resultado.`);
  }
  if (!input.hasOos) {
    factors.push("No se ejecutó ningún tramo Out-of-Sample — no hay forma de saber si el rendimiento se generaliza.");
  } else if (input.oosTrades < MIN_TRADES_MEDIUM) {
    factors.push(`El tramo OOS solo tiene ${input.oosTrades} operación(es) — evidencia fuera de muestra débil.`);
  }
  if (input.overfitting?.risk === "HIGH") {
    factors.push("El detector de sobreajuste marca riesgo ALTO.");
  }
  if (input.robustness === "FRAGILE" || input.robustness === "INSUFFICIENT_DATA") {
    factors.push(`Clasificación de robustez: ${input.robustness}.`);
  }
  if (aiAvailabilityPct < 50 && input.decisions.length > 0) {
    factors.push(`Solo el ${aiAvailabilityPct.toFixed(0)}% de las decisiones tuvieron evaluación de IA disponible — la mayoría fueron omitidas por falta de datos históricos.`);
  }

  let verdict: EvidenceQualityReport["verdict"];
  if (sampleSize < MIN_TRADES_MEDIUM || input.dataQuality.coveragePct < MIN_COVERAGE_PCT) {
    verdict = "INSUFFICIENT_EVIDENCE";
  } else {
    const disqualifyingForHighOrMedium = input.overfitting?.risk === "HIGH" || input.robustness === "FRAGILE" || input.robustness === "INSUFFICIENT_DATA" || !input.hasOos;
    if (disqualifyingForHighOrMedium) {
      verdict = "LOW";
    } else if (sampleSize >= MIN_TRADES_HIGH && input.robustness === "ROBUST" && input.oosTrades >= MIN_TRADES_MEDIUM) {
      verdict = "HIGH";
    } else {
      verdict = "MEDIUM";
    }
  }

  if (factors.length === 0) factors.push("Ningún factor de alerta detectado en los criterios evaluados.");

  return {
    verdict,
    dataQuality: input.dataQuality.coveragePct,
    sampleSize,
    historicalCoveragePct: input.dataQuality.coveragePct,
    aiAvailabilityPct,
    oosQualityScore,
    robustnessScore: input.robustnessScore,
    overfittingRisk: input.overfitting?.risk ?? null,
    factors,
  };
}
