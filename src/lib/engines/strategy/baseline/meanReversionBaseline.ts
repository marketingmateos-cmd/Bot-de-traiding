import { atr, sma, zScore } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "./shared";

/**
 * Fase 11 — MeanReversionBaselineStrategy. A configurable-period z-score:
 * when the current close deviates more than `deviationThreshold` standard
 * deviations below its own `meanPeriod`-bar mean, bet on reversion UP
 * (LONG); more than `deviationThreshold` above, bet on reversion DOWN
 * (SHORT). Stop is volatility-based (ATR); target is stop-distance * RRR
 * (not "back to the mean" — kept consistent with the other three baselines
 * for a fair, simple comparison, spec section 6).
 */
export const meanReversionBaselineStrategy: StrategyDefinition = {
  id: "mean-reversion-baseline-v1",
  kind: "MEAN_REVERSION",
  name: "Mean Reversion Baseline (Fase 11)",
  version: "1.0",
  defaultParams: { meanPeriod: 20, deviationThreshold: 2, volatilityPeriod: 14, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const meanPeriod = Number(params.meanPeriod ?? 20);
    const deviationThreshold = Number(params.deviationThreshold ?? 2);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const rrr = Number(params.rrr ?? 1.5);

    if (bars.length < meanPeriod + 1) return null;

    const closes = bars.map((b) => b.close);
    const meanArr = sma(closes, meanPeriod);
    const zArr = zScore(closes, meanPeriod);
    const meanPrice = meanArr[meanArr.length - 1];
    const z = zArr[zArr.length - 1];
    if (meanPrice === null || z === null) return null;

    const current = bars[bars.length - 1];
    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;
    if (stopDistance <= 0) return null;

    if (z <= -deviationThreshold) {
      return {
        kind: "MEAN_REVERSION",
        direction: "LONG",
        strength: Math.min(1, Math.abs(z) / (deviationThreshold * 2)),
        reason: `Precio ${current.close.toFixed(2)} a ${z.toFixed(2)} desviaciones estándar por debajo de la media de ${meanPeriod} velas (${meanPrice.toFixed(2)}).`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { meanPrice, zScore: z, stopDistance, rrr },
      };
    }
    if (z >= deviationThreshold) {
      return {
        kind: "MEAN_REVERSION",
        direction: "SHORT",
        strength: Math.min(1, Math.abs(z) / (deviationThreshold * 2)),
        reason: `Precio ${current.close.toFixed(2)} a ${z.toFixed(2)} desviaciones estándar por encima de la media de ${meanPeriod} velas (${meanPrice.toFixed(2)}).`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { meanPrice, zScore: z, stopDistance, rrr },
      };
    }
    return null;
  },
};
