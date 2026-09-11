import type { BacktestMetrics } from "./backtest";
import type { WalkForwardResult } from "./walkForward";

export interface RobustnessInputs {
  baseMetrics: BacktestMetrics;
  walkForward: WalkForwardResult | null;
  parameterPerturbationReturns: number[]; // total return % from re-running with slightly jittered params
  crossAssetReturns: number[]; // total return % from re-running the same params on other assets
  costSensitivityReturns: number[]; // total return % under increasing slippage/fee assumptions
}

export interface RobustnessReport {
  score: number; // 0-100
  factors: { name: string; score: number; detail: string }[];
}

/**
 * Robustness Lab (spec §26). A strategy only earns a high score by surviving
 * *several independent* stress tests — no single good backtest run can push
 * this score up on its own.
 */
export function computeRobustnessScore(input: RobustnessInputs): RobustnessReport {
  const factors: { name: string; score: number; detail: string }[] = [];

  // 1. Sample size / trade count.
  const tradeCountScore = Math.min(100, (input.baseMetrics.trades / 100) * 100);
  factors.push({ name: "Tamaño de Muestra", score: tradeCountScore, detail: `${input.baseMetrics.trades} operaciones en la ejecución base.` });

  // 2. Walk-forward consistency.
  if (input.walkForward && input.walkForward.windows.length > 0) {
    const wfScore = input.walkForward.aggregateOosMetrics.winRateOfWindows * 100;
    factors.push({
      name: "Consistencia Walk-Forward",
      score: wfScore,
      detail: `${(input.walkForward.aggregateOosMetrics.winRateOfWindows * 100).toFixed(0)}% de las ventanas OOS fueron rentables.`,
    });
  } else {
    factors.push({ name: "Consistencia Walk-Forward", score: 0, detail: "No hay datos de walk-forward disponibles." });
  }

  // 3. Parameter sensitivity: low variance across small jitters = robust.
  if (input.parameterPerturbationReturns.length > 1) {
    const stability = computeStabilityScore(input.parameterPerturbationReturns);
    factors.push({ name: "Estabilidad de Parámetros", score: stability, detail: `Estabilidad a través de ${input.parameterPerturbationReturns.length} perturbaciones de parámetros.` });
  } else {
    factors.push({ name: "Estabilidad de Parámetros", score: 0, detail: "No hay ejecuciones de perturbación de parámetros disponibles." });
  }

  // 4. Cross-asset generalization.
  if (input.crossAssetReturns.length > 0) {
    const positiveShare = input.crossAssetReturns.filter((r) => r > 0).length / input.crossAssetReturns.length;
    factors.push({ name: "Generalización entre Activos", score: positiveShare * 100, detail: `Rentable en el ${Math.round(positiveShare * 100)}% de los otros activos probados.` });
  } else {
    factors.push({ name: "Generalización entre Activos", score: 0, detail: "No hay ejecuciones entre activos disponibles." });
  }

  // 5. Cost sensitivity: does the edge survive higher costs?
  if (input.costSensitivityReturns.length > 0) {
    const survivalShare = input.costSensitivityReturns.filter((r) => r > 0).length / input.costSensitivityReturns.length;
    factors.push({ name: "Sensibilidad a Costes", score: survivalShare * 100, detail: `Sigue siendo rentable en el ${Math.round(survivalShare * 100)}% de los escenarios de costes elevados.` });
  } else {
    factors.push({ name: "Sensibilidad a Costes", score: 0, detail: "No hay ejecuciones de sensibilidad a costes disponibles." });
  }

  const score = Math.round(factors.reduce((s, f) => s + f.score, 0) / factors.length);
  return { score, factors };
}

function computeStabilityScore(returns: number[]): number {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  if (mean <= 0) return 0;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const coefficientOfVariation = Math.sqrt(variance) / Math.abs(mean);
  // Lower CoV = more stable across perturbations. Map CoV in [0, 2+] to score [100, 0].
  return Math.max(0, Math.min(100, 100 - coefficientOfVariation * 50));
}
