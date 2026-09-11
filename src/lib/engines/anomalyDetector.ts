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
      anomalies.push({ type: "IMPOSSIBLE_RESULT", severity: "HIGH", message: "A trade recorded a non-finite P&L." });
    }
    if (Math.abs(pnl) > 100000) {
      anomalies.push({ type: "IMPOSSIBLE_RESULT", severity: "HIGH", message: `A trade recorded an implausible P&L of ${pnl.toFixed(2)} on a €100-scale paper account.` });
    }
  }

  if (input.duplicateOpenPositionCount > 0) {
    anomalies.push({ type: "DUPLICATE_POSITION", severity: "HIGH", message: `${input.duplicateOpenPositionCount} duplicate open position(s) detected.` });
  }

  if (input.dataQualityScore < 40) {
    anomalies.push({ type: "DATA_CORRUPTION", severity: "HIGH", message: `Data quality score ${input.dataQualityScore} indicates likely corrupt inputs.` });
  }

  if (!input.apiHealthy) {
    anomalies.push({ type: "API_DEGRADED", severity: "MEDIUM", message: "One or more data providers are degraded or unreachable." });
  }

  if (!input.reconciliationConsistent) {
    anomalies.push({ type: "STATE_INCONSISTENCY", severity: "HIGH", message: "Position state reconciliation failed." });
  }

  if (input.priceJumpPct !== null && Math.abs(input.priceJumpPct) > 40) {
    anomalies.push({ type: "PRICE_ANOMALY", severity: "MEDIUM", message: `Observed a ${input.priceJumpPct.toFixed(1)}% single-bar price move — verify before trusting signals.` });
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
