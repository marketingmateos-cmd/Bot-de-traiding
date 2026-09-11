import type { StrategyDefinition } from "./types";

export const eventDrivenStrategy: StrategyDefinition = {
  id: "event-driven",
  kind: "EVENT_DRIVEN",
  name: "Event-Driven News Reaction",
  version: "1.0",
  defaultParams: { minImpact: 65, minSentiment: 0.35 },
  timeframe: "H1",
  recommendedRegimes: ["NEUTRAL", "TRANSITION", "HIGH_VOLATILITY"],
  defaultStopLossPct: 3.5,
  defaultTakeProfitPct: 5,
  defaultTrailingStopPct: 2,
  costModel: { feeBps: 12, slippageBps: 15 },
  evaluate(bars, features, params, _regime, context) {
    const minImpact = Number(params.minImpact ?? 65);
    const minSentiment = Number(params.minSentiment ?? 0.35);
    const impact = context?.newsImpactScore;
    const sentiment = context?.newsSentiment;
    if (impact === undefined || sentiment === undefined) return null;
    if (impact < minImpact || Math.abs(sentiment) < minSentiment) return null;

    return {
      kind: "EVENT_DRIVEN",
      direction: sentiment > 0 ? "LONG" : "SHORT",
      strength: Math.min(1, (impact / 100) * Math.abs(sentiment) + 0.2),
      reason: `Noticia de alto impacto (impacto ${impact}) con sentimiento ${sentiment.toFixed(2)} supera los umbrales.`,
    };
  },
};
