import type { StrategyDefinition } from "./types";

export const meanReversionStrategy: StrategyDefinition = {
  id: "mean-reversion",
  kind: "MEAN_REVERSION",
  name: "Bollinger Mean Reversion",
  version: "1.0",
  defaultParams: { rsiExtreme: 30 },
  timeframe: "H1",
  recommendedRegimes: ["RANGE", "NEUTRAL", "LOW_VOLATILITY"],
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: { feeBps: 10, slippageBps: 5 },
  evaluate(bars, features, params) {
    if (features.bbUpper === null || features.bbLower === null || features.rsi14 === null) return null;
    const rsiExtreme = Number(params.rsiExtreme ?? 30);
    const price = features.close;

    if (price <= features.bbLower && features.rsi14 <= rsiExtreme) {
      return {
        kind: "MEAN_REVERSION",
        direction: "LONG",
        strength: Math.min(1, (rsiExtreme - features.rsi14) / rsiExtreme + 0.3),
        reason: `El precio ${price.toFixed(2)} está en/por debajo de la banda inferior de Bollinger con RSI de sobreventa ${features.rsi14.toFixed(1)}.`,
      };
    }
    if (price >= features.bbUpper && features.rsi14 >= 100 - rsiExtreme) {
      return {
        kind: "MEAN_REVERSION",
        direction: "SHORT",
        strength: Math.min(1, (features.rsi14 - (100 - rsiExtreme)) / rsiExtreme + 0.3),
        reason: `El precio ${price.toFixed(2)} está en/por encima de la banda superior de Bollinger con RSI de sobrecompra ${features.rsi14.toFixed(1)}.`,
      };
    }
    return null;
  },
};
