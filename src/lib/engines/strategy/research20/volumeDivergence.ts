import { atr } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";

/**
 * Fase 20 — Family C: Volume-Price Divergence. Formulas/params frozen
 * BEFORE any Discovery/Validation run in `research/phase20PreRegistration.ts`
 * (`F20C_PARAMS`) — this file only implements that pre-registered logic
 * (spec Condición 1).
 *
 * Hypothesis: a new price extreme (a high/low beyond the prior `lookback`
 * bars, same convention as Breakout Baseline) made on ABNORMALLY LOW
 * volume (current bar's volume < `volumeRatioThreshold` × the average
 * volume of the prior `lookback` window) signals weak participation behind
 * that extreme — a divergence between price and volume — and may be more
 * likely to revert than to continue, unlike an extreme confirmed by strong
 * volume. This is the mirror image of Fase 17's Family B (Volume
 * Confirmation), which looks for HIGH volume confirming a move; this
 * strategy looks for the ABSENCE of volume confirming an extreme, and
 * trades the reversal rather than the continuation.
 *
 * Causal: `window` is strictly the `lookback` bars BEFORE the current bar
 * (never including it), and the current bar's own volume/high/low are the
 * only "current" values read — nothing from bars after it.
 */
export const volumeDivergenceStrategy: StrategyDefinition = {
  id: "research20-volume-price-divergence-v1",
  kind: "VOLUME_PRICE_DIVERGENCE",
  name: "Volume-Price Divergence (Fase 20-C)",
  version: "1.0",
  defaultParams: { lookback: 20, volatilityPeriod: 14, volumeRatioThreshold: 0.7, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const lookback = Number(params.lookback ?? 20);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const volumeRatioThreshold = Number(params.volumeRatioThreshold ?? 0.7);
    const rrr = Number(params.rrr ?? 1.5);

    if (bars.length < lookback + 1 + volatilityPeriod) return null;

    const window = bars.slice(-lookback - 1, -1);
    const highestHigh = Math.max(...window.map((b) => b.high));
    const lowestLow = Math.min(...window.map((b) => b.low));
    const avgVolume = window.reduce((sum, b) => sum + b.volume, 0) / window.length;
    if (avgVolume <= 0) return null;

    const current = bars[bars.length - 1];
    const volumeRatio = current.volume / avgVolume;
    if (volumeRatio >= volumeRatioThreshold) return null; // no divergence — volume confirms, doesn't diverge

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;

    // New high on weak volume -> expect reversal DOWN.
    if (current.high > highestHigh) {
      return {
        kind: "VOLUME_PRICE_DIVERGENCE",
        direction: "SHORT",
        strength: Math.min(1, (volumeRatioThreshold - volumeRatio) / volumeRatioThreshold + 0.5),
        reason: `Nuevo máximo de ${lookback} velas (${current.high.toFixed(2)} > ${highestHigh.toFixed(2)}) con volumen débil (ratio ${volumeRatio.toFixed(2)} < ${volumeRatioThreshold}) — divergencia precio/volumen, se opera la reversión.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { highestHigh, lowestLow, volumeRatio, stopDistance, rrr },
      };
    }
    // New low on weak volume -> expect reversal UP.
    if (current.low < lowestLow) {
      return {
        kind: "VOLUME_PRICE_DIVERGENCE",
        direction: "LONG",
        strength: Math.min(1, (volumeRatioThreshold - volumeRatio) / volumeRatioThreshold + 0.5),
        reason: `Nuevo mínimo de ${lookback} velas (${current.low.toFixed(2)} < ${lowestLow.toFixed(2)}) con volumen débil (ratio ${volumeRatio.toFixed(2)} < ${volumeRatioThreshold}) — divergencia precio/volumen, se opera la reversión.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { highestHigh, lowestLow, volumeRatio, stopDistance, rrr },
      };
    }
    return null;
  },
};
