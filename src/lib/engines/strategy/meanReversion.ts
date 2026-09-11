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
        reason: `Price ${price.toFixed(2)} at/below lower Bollinger band with oversold RSI ${features.rsi14.toFixed(1)}.`,
      };
    }
    if (price >= features.bbUpper && features.rsi14 >= 100 - rsiExtreme) {
      return {
        kind: "MEAN_REVERSION",
        direction: "SHORT",
        strength: Math.min(1, (features.rsi14 - (100 - rsiExtreme)) / rsiExtreme + 0.3),
        reason: `Price ${price.toFixed(2)} at/above upper Bollinger band with overbought RSI ${features.rsi14.toFixed(1)}.`,
      };
    }
    return null;
  },
};
