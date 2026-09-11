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
    flags.push(`La estrategia tiene ${paramCount} parámetros libres — más grados de libertad significa más formas de ajustarse al ruido.`);
    score += 15;
  }

  if (baseMetrics.trades < 30) {
    flags.push(`Solo ${baseMetrics.trades} operaciones en el backtest base — demasiado pocas para distinguir ventaja de ruido.`);
    score += 25;
  }

  if (walkForward && walkForward.windows.length > 0) {
    const degradedWindows = walkForward.windows.filter((w) => w.degraded).length;
    const degradedShare = degradedWindows / walkForward.windows.length;
    if (degradedShare > 0.5) {
      flags.push(`El ${Math.round(degradedShare * 100)}% de las ventanas walk-forward muestran un rendimiento fuera de muestra que se desploma frente al de dentro de muestra.`);
      score += 30;
    }
    const trainReturns = walkForward.windows.map((w) => w.trainMetrics.totalReturnPct);
    const oosReturns = walkForward.windows.map((w) => w.oosMetrics.totalReturnPct);
    const avgTrain = trainReturns.reduce((a, b) => a + b, 0) / trainReturns.length;
    const avgOos = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
    if (avgTrain > 0 && avgOos < avgTrain * 0.4) {
      flags.push(`El retorno medio fuera de muestra (${avgOos.toFixed(1)}%) está muy por debajo del retorno medio dentro de muestra (${avgTrain.toFixed(1)}%).`);
      score += 20;
    }
  } else {
    flags.push("Todavía no existen datos de walk-forward — no se puede descartar el sobreajuste.");
    score += 10;
  }

  if (baseMetrics.profitFactor !== null && baseMetrics.profitFactor > 5) {
    flags.push(`Un profit factor de ${baseMetrics.profitFactor.toFixed(1)} es inusualmente alto — verifica que no esté impulsado por una o dos operaciones atípicas.`);
    score += 10;
  }

  score = Math.min(100, score);
  const risk: OverfittingRisk = score >= 55 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";

  return { risk, score, flags };
}
