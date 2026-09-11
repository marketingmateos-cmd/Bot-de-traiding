import type { StrategyDefinition } from "./types";

export const momentumStrategy: StrategyDefinition = {
  id: "momentum",
  kind: "MOMENTUM",
  name: "Momentum (RSI + MACD histogram)",
  version: "1.0",
  defaultParams: { rsiLongMin: 55, rsiShortMax: 45, macdConfirm: true },
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "BEAR", "STRONG_BEAR", "HIGH_VOLATILITY"],
  defaultStopLossPct: 2.5,
  defaultTakeProfitPct: 5,
  defaultTrailingStopPct: 1.5,
  costModel: { feeBps: 10, slippageBps: 6 },
  evaluate(bars, features, params) {
    if (features.rsi14 === null) return null;
    const rsiLongMin = Number(params.rsiLongMin ?? 55);
    const rsiShortMax = Number(params.rsiShortMax ?? 45);
    const macdConfirm = Boolean(params.macdConfirm ?? true);
    const macdOk = features.macdHistogram !== null;

    if (features.rsi14 >= rsiLongMin && features.momentum > 0.1 && (!macdConfirm || (macdOk && (features.macdHistogram as number) > 0))) {
      return {
        kind: "MOMENTUM",
        direction: "LONG",
        strength: Math.min(1, features.momentum + 0.2),
        reason: `RSI ${features.rsi14.toFixed(1)} >= ${rsiLongMin} with positive momentum${macdConfirm ? " and confirming MACD histogram" : ""}.`,
      };
    }
    if (features.rsi14 <= rsiShortMax && features.momentum < -0.1 && (!macdConfirm || (macdOk && (features.macdHistogram as number) < 0))) {
      return {
        kind: "MOMENTUM",
        direction: "SHORT",
        strength: Math.min(1, Math.abs(features.momentum) + 0.2),
        reason: `RSI ${features.rsi14.toFixed(1)} <= ${rsiShortMax} with negative momentum${macdConfirm ? " and confirming MACD histogram" : ""}.`,
      };
    }
    return null;
  },
};
