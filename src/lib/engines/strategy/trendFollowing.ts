import type { StrategyDefinition } from "./types";

export const trendFollowingStrategy: StrategyDefinition = {
  id: "trend-following",
  kind: "TREND_FOLLOWING",
  name: "Trend Following (EMA20/EMA50)",
  version: "1.0",
  defaultParams: { trendThreshold: 0.25 },
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "BEAR", "STRONG_BEAR"],
  defaultStopLossPct: 3,
  defaultTakeProfitPct: 6,
  defaultTrailingStopPct: 2,
  costModel: { feeBps: 10, slippageBps: 5 },
  evaluate(bars, features, params) {
    const threshold = Number(params.trendThreshold ?? 0.25);
    if (features.sma20 === null || features.sma50 === null) return null;
    if (features.trend > threshold) {
      return {
        kind: "TREND_FOLLOWING",
        direction: "LONG",
        strength: Math.min(1, features.trend),
        reason: `EMA20 por encima de EMA50 con puntuación de tendencia ${features.trend.toFixed(2)}, superando el umbral ${threshold}.`,
      };
    }
    if (features.trend < -threshold) {
      return {
        kind: "TREND_FOLLOWING",
        direction: "SHORT",
        strength: Math.min(1, Math.abs(features.trend)),
        reason: `EMA20 por debajo de EMA50 con puntuación de tendencia ${features.trend.toFixed(2)}, superando el umbral ${threshold}.`,
      };
    }
    return null;
  },
};
