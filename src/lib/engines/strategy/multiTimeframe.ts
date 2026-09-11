import type { StrategyDefinition } from "./types";

export const multiTimeframeStrategy: StrategyDefinition = {
  id: "multi-timeframe",
  kind: "MULTI_TIMEFRAME",
  name: "Multi-Timeframe Confirmation",
  version: "1.0",
  defaultParams: { minAlignment: 0.15 },
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "BEAR", "STRONG_BEAR", "NEUTRAL"],
  defaultStopLossPct: 3,
  defaultTakeProfitPct: 6,
  defaultTrailingStopPct: 2,
  costModel: { feeBps: 10, slippageBps: 5 },
  evaluate(bars, features, params, _regime, context) {
    const minAlignment = Number(params.minAlignment ?? 0.15);
    const higherTrend = context?.higherTimeframeTrend;
    // Requires a higher-timeframe trend reading (e.g. H4/D1) to be supplied by
    // the caller — this strategy explicitly refuses to fire "blind" on a
    // single timeframe, which is the entire point of it existing.
    if (higherTrend === undefined) return null;

    const lowerTrend = features.trend;
    const aligned = Math.sign(lowerTrend) === Math.sign(higherTrend);
    if (!aligned) return null;
    if (Math.abs(lowerTrend) < minAlignment || Math.abs(higherTrend) < minAlignment) return null;

    const direction = lowerTrend > 0 ? "LONG" : "SHORT";
    return {
      kind: "MULTI_TIMEFRAME",
      direction,
      strength: Math.min(1, (Math.abs(lowerTrend) + Math.abs(higherTrend)) / 2),
      reason: `La tendencia de la temporalidad de entrada (${lowerTrend.toFixed(2)}) está alineada con la tendencia de la temporalidad superior (${higherTrend.toFixed(2)}).`,
    };
  },
};
