export interface AnomalyCheckInput {
  recentTradePnls: number[];
  duplicateOpenPositionCount: number;
  dataQualityScore: number;
  apiHealthy: boolean;
  reconciliationConsistent: boolean;
  priceJumpPct: number | null; // largest single-bar % move recently observed
}

export interface Anomaly {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}

/** Anomaly Detector (spec §38) — flags results/behavior that shouldn't be possible even in a volatile market. */
export function detectAnomalies(input: AnomalyCheckInput): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const pnl of input.recentTradePnls) {
    if (!Number.isFinite(pnl)) {
      anomalies.push({ type: "IMPOSSIBLE_RESULT", severity: "HIGH", message: "Una operación registró un P&L no finito." });
    }
    if (Math.abs(pnl) > 100000) {
      anomalies.push({ type: "IMPOSSIBLE_RESULT", severity: "HIGH", message: `Una operación registró un P&L implausible de ${pnl.toFixed(2)} en una cuenta paper de escala €100.` });
    }
  }

  if (input.duplicateOpenPositionCount > 0) {
    anomalies.push({ type: "DUPLICATE_POSITION", severity: "HIGH", message: `${input.duplicateOpenPositionCount} posición(es) abierta(s) duplicada(s) detectada(s).` });
  }

  if (input.dataQualityScore < 40) {
    anomalies.push({ type: "DATA_CORRUPTION", severity: "HIGH", message: `La puntuación de calidad de datos (${input.dataQualityScore}) indica probables entradas corruptas.` });
  }

  if (!input.apiHealthy) {
    anomalies.push({ type: "API_DEGRADED", severity: "MEDIUM", message: "Uno o más proveedores de datos están degradados o inaccesibles." });
  }

  if (!input.reconciliationConsistent) {
    anomalies.push({ type: "STATE_INCONSISTENCY", severity: "HIGH", message: "Falló la reconciliación del estado de posiciones." });
  }

  if (input.priceJumpPct !== null && Math.abs(input.priceJumpPct) > 40) {
    anomalies.push({ type: "PRICE_ANOMALY", severity: "MEDIUM", message: `Se observó un movimiento de precio del ${input.priceJumpPct.toFixed(1)}% en una sola vela — verificar antes de confiar en las señales.` });
  }

  return anomalies;
}

export function computeSystemHealthScore(anomalies: Anomaly[], dataQualityScore: number, apiHealthy: boolean): number {
  let score = 100;
  for (const a of anomalies) {
    score -= a.severity === "HIGH" ? 20 : a.severity === "MEDIUM" ? 10 : 4;
  }
  score = score * 0.7 + dataQualityScore * 0.3;
  if (!apiHealthy) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}
