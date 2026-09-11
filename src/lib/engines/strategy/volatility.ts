import type { StrategyDefinition } from "./types";

export const volatilityStrategy: StrategyDefinition = {
  id: "volatility-expansion",
  kind: "VOLATILITY",
  name: "Volatility Expansion",
  version: "1.0",
  defaultParams: { atrExpansionRatio: 1.4, lookback: 14 },
  timeframe: "H1",
  recommendedRegimes: ["HIGH_VOLATILITY", "TRANSITION"],
  defaultStopLossPct: 4,
  defaultTakeProfitPct: 7,
  defaultTrailingStopPct: 2.5,
  costModel: { feeBps: 10, slippageBps: 10 },
  evaluate(bars, features, params) {
    const ratio = Number(params.atrExpansionRatio ?? 1.4);
    const lookback = Number(params.lookback ?? 14);
    if (features.atr14 === null || bars.length < lookback + 1) return null;

    const priorAtrBars = bars.slice(-lookback - 5, -5);
    if (priorAtrBars.length < 5) return null;
    const priorRanges = priorAtrBars.map((b) => b.high - b.low);
    const priorAvgRange = priorRanges.reduce((a, b) => a + b, 0) / priorRanges.length;
    if (priorAvgRange <= 0) return null;

    const expansionRatio = features.atr14 / priorAvgRange;
    if (expansionRatio < ratio) return null;

    const current = bars[bars.length - 1];
    const direction = current.close >= current.open ? "LONG" : "SHORT";
    return {
      kind: "VOLATILITY",
      direction,
      strength: Math.min(1, (expansionRatio - ratio) / ratio + 0.4),
      reason: `El ATR se expandió ${expansionRatio.toFixed(2)}x frente al rango medio anterior (umbral ${ratio}x); se opera en la dirección de ruptura de la vela de expansión.`,
    };
  },
};
