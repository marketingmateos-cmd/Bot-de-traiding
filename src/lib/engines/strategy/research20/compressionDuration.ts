import { atr } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";
import { computeAtrPercentileRanks, computeCoilLength } from "../../edgeSignals/compression";

/**
 * Fase 20 — Family E: Compression Duration ("Coiling Length"). Formulas/
 * params frozen BEFORE any Discovery/Validation run in
 * `research/phase20PreRegistration.ts` (`F20E_PARAMS`, spec Condición 1) —
 * this file only implements that pre-registered logic.
 *
 * Hypothesis: it is not just WHETHER a market was compressed on the bar
 * immediately before a breakout (F17-A's test), but HOW LONG it stayed
 * compressed — a breakout out of a compression that has persisted for at
 * least `minCoilLength` consecutive bars may have more energy/continuation
 * than a breakout out of only a single compressed bar. `squeezeLookback`
 * and `squeezePercentile` are REUSED VERBATIM from F17-A (not re-chosen —
 * see `F20E_PARAMS`'s own comment), so that `minCoilLength` is the ONLY
 * structural difference between this strategy and F17-A, keeping any later
 * "is this just F17-A renamed" comparison clean (spec Condición 7 — that
 * comparison itself lives in `research/phase20Comparison.ts`, not here).
 *
 * Causal: `computeAtrPercentileRanks`/`computeCoilLength` (both in
 * `engines/edgeSignals/compression.ts`) only ever look backward from a
 * given index; the coil length judged here is as of the bar BEFORE the
 * current one (mirroring F17-A's own "squeeze judged on the prior bar"
 * convention), and the breakout range is the `rangeLookback` bars
 * strictly before the current bar.
 */
export const compressionDurationStrategy: StrategyDefinition = {
  id: "research20-compression-duration-v1",
  kind: "COMPRESSION_DURATION",
  name: "Compression Duration Breakout (Fase 20-E)",
  version: "1.0",
  defaultParams: { atrPeriod: 14, squeezeLookback: 40, squeezePercentile: 20, rangeLookback: 10, expansionMultiplier: 1.3, minCoilLength: 10, rrr: 1.5 },
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
    const minCoilLength = Number(params.minCoilLength ?? 10);
    const rrr = Number(params.rrr ?? 1.5);

    const minBars = squeezeLookback + rangeLookback + atrPeriod + minCoilLength + 2;
    if (bars.length < minBars) return null;

    const ranks = computeAtrPercentileRanks(bars, atrPeriod, squeezeLookback);
    const priorIndex = bars.length - 2; // the bar immediately before the current one
    const coilLength = computeCoilLength(ranks, priorIndex, squeezePercentile);
    if (coilLength < minCoilLength) return null;

    const atrArr = atr(bars, atrPeriod);
    const currentAtr = atrArr[atrArr.length - 1];
    if (currentAtr === null || currentAtr <= 0) return null;

    const rangeWindow = bars.slice(-1 - rangeLookback, -1);
    const squeezeHigh = Math.max(...rangeWindow.map((b) => b.high));
    const squeezeLow = Math.min(...rangeWindow.map((b) => b.low));

    const current = bars[bars.length - 1];
    const currentRange = current.high - current.low;
    const expansionThreshold = expansionMultiplier * currentAtr;
    if (currentRange <= expansionThreshold) return null;

    const stopDistance = currentAtr;
    if (stopDistance <= 0) return null;

    if (current.close > squeezeHigh) {
      return {
        kind: "COMPRESSION_DURATION",
        direction: "LONG",
        strength: Math.min(1, currentRange / expansionThreshold - 1 + 0.5),
        reason: `Ruptura al alza (${current.close.toFixed(2)} > ${squeezeHigh.toFixed(2)}) tras ${coilLength} velas consecutivas de compresión (>= minCoilLength=${minCoilLength}), con expansión real de rango.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { squeezeHigh, squeezeLow, coilLength, stopDistance, rrr },
      };
    }
    if (current.close < squeezeLow) {
      return {
        kind: "COMPRESSION_DURATION",
        direction: "SHORT",
        strength: Math.min(1, currentRange / expansionThreshold - 1 + 0.5),
        reason: `Ruptura a la baja (${current.close.toFixed(2)} < ${squeezeLow.toFixed(2)}) tras ${coilLength} velas consecutivas de compresión (>= minCoilLength=${minCoilLength}), con expansión real de rango.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { squeezeHigh, squeezeLow, coilLength, stopDistance, rrr },
      };
    }
    return null;
  },
};
