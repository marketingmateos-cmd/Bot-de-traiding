import { atr } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";

/**
 * Fase 17 — Family A: Volatility Expansion / Contraction. Hypothesis,
 * expected/failure regime, and full parameter justification live in
 * `./hypothesisRegistry.ts` (pre-registered BEFORE any benchmark ran) —
 * this file is only the implementation of that pre-registered logic. A
 * genuine two-stage signal: (1) was the market compressed just before this
 * bar (ATR in the bottom `squeezePercentile` of its own trailing
 * `squeezeLookback` history), (2) does the current bar break the prior
 * `rangeLookback`-bar range with a REAL expansion of range (not a mere
 * one-tick cross) — deliberately distinct from the existing
 * `volatility.ts` strategy, which reacts to already-realized expansion
 * without requiring any prior compression.
 */
export const volatilitySqueezeStrategy: StrategyDefinition = {
  id: "research-volatility-squeeze-v1",
  kind: "VOLATILITY_SQUEEZE",
  name: "Volatility Squeeze Breakout (Fase 17)",
  version: "1.0",
  defaultParams: { atrPeriod: 14, squeezeLookback: 40, squeezePercentile: 20, rangeLookback: 10, expansionMultiplier: 1.3, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const atrPeriod = Number(params.atrPeriod ?? 14);
    const squeezeLookback = Number(params.squeezeLookback ?? 40);
    const squeezePercentile = Number(params.squeezePercentile ?? 20);
    const rangeLookback = Number(params.rangeLookback ?? 10);
    const expansionMultiplier = Number(params.expansionMultiplier ?? 1.3);
    const rrr = Number(params.rrr ?? 1.5);

    const minBars = squeezeLookback + rangeLookback + atrPeriod + 2;
    if (bars.length < minBars) return null;

    const atrArr = atr(bars, atrPeriod);
    const currentAtr = atrArr[atrArr.length - 1];
    if (currentAtr === null || currentAtr <= 0) return null;

    // The squeeze condition is judged on the bar BEFORE the current one —
    // never on the current bar's own (possibly already-expanded) ATR.
    const priorAtr = atrArr[atrArr.length - 2];
    if (priorAtr === null || priorAtr <= 0) return null;

    const priorAtrHistory = atrArr.slice(atrArr.length - 1 - squeezeLookback, atrArr.length - 1).filter((v): v is number => v !== null);
    if (priorAtrHistory.length < squeezeLookback * 0.8) return null;
    const rank = (priorAtrHistory.filter((v) => v <= priorAtr).length / priorAtrHistory.length) * 100;
    if (rank > squeezePercentile) return null; // no squeeze as of the setup bar — nothing to say

    // The breakout range: strictly the rangeLookback bars BEFORE the current bar.
    const rangeWindow = bars.slice(-1 - rangeLookback, -1);
    const squeezeHigh = Math.max(...rangeWindow.map((b) => b.high));
    const squeezeLow = Math.min(...rangeWindow.map((b) => b.low));

    const current = bars[bars.length - 1];
    const currentRange = current.high - current.low;
    const expansionThreshold = expansionMultiplier * currentAtr;
    if (currentRange <= expansionThreshold) return null; // no real expansion on this bar

    const stopDistance = currentAtr;
    if (stopDistance <= 0) return null;

    if (current.close > squeezeHigh) {
      return {
        kind: "VOLATILITY_SQUEEZE",
        direction: "LONG",
        strength: Math.min(1, currentRange / expansionThreshold - 1 + 0.5),
        reason: `Ruptura al alza (${current.close.toFixed(2)} > ${squeezeHigh.toFixed(2)}) tras compresión de volatilidad (percentil ATR ${rank.toFixed(0)}) con expansión real de rango.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { squeezeHigh, squeezeLow, priorAtrPercentile: rank, stopDistance, rrr },
      };
    }
    if (current.close < squeezeLow) {
      return {
        kind: "VOLATILITY_SQUEEZE",
        direction: "SHORT",
        strength: Math.min(1, currentRange / expansionThreshold - 1 + 0.5),
        reason: `Ruptura a la baja (${current.close.toFixed(2)} < ${squeezeLow.toFixed(2)}) tras compresión de volatilidad (percentil ATR ${rank.toFixed(0)}) con expansión real de rango.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { squeezeHigh, squeezeLow, priorAtrPercentile: rank, stopDistance, rrr },
      };
    }
    return null;
  },
};
