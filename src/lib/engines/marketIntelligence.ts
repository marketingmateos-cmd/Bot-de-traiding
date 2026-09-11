import type { FeatureSnapshot } from "./features";
import type { RegimeResult } from "./regime";
import type { NewsSummary } from "./news";
import type { SentimentAnalysis } from "./sentiment";
import type { OnChainMetricResult } from "@/lib/providers/types";
import type { DataQualityReport } from "./dataQuality";

export interface MarketIntelligenceComponents {
  trend: number;
  momentum: number;
  volatility: number;
  volume: number;
  news: number;
  sentiment: number;
  onChain: number | null; // null if all on-chain metrics unavailable
  regime: string;
}

export interface MarketIntelligenceResult {
  score: number; // 0-100
  components: MarketIntelligenceComponents;
  dataConfidence: number; // 0-100
}

const WEIGHTS = {
  trend: 0.2,
  momentum: 0.15,
  volatility: 0.1,
  volume: 0.1,
  news: 0.15,
  sentiment: 0.15,
  onChain: 0.15,
};

/**
 * Market Intelligence Score (spec §8). A single configurable composite of
 * trend/momentum/volatility/volume/news/sentiment/on-chain/regime, always
 * shown with its components broken out (never as an opaque single number)
 * plus a separate Data Confidence figure so a high score built on thin data
 * doesn't masquerade as a strong signal.
 */
export function computeMarketIntelligence(
  features: FeatureSnapshot,
  regime: RegimeResult,
  news: NewsSummary,
  sentiment: SentimentAnalysis,
  onChainMetrics: OnChainMetricResult[],
  dataQuality: DataQualityReport
): MarketIntelligenceResult {
  const trendScore = Math.round(50 + features.trend * 50);
  const momentumScore = Math.round(50 + features.momentum * 50);

  // Volatility is scored as "healthy mid-range = good", extreme = penalized,
  // since neither dead-flat nor chaotic markets are "high quality" for most
  // strategies.
  const volPercentile = regime.details.volatilityPercentile;
  const volatilityScore = Math.round(100 - Math.abs(volPercentile - 50) * 1.2);

  const volumeZ = features.volumeZScore20 ?? 0;
  const volumeScore = Math.round(Math.max(0, Math.min(100, 50 + volumeZ * 20)));

  const availableOnChain = onChainMetrics.filter((m) => m.available && m.value !== null);
  let onChainScore: number | null = null;
  if (availableOnChain.length > 0) {
    // Simple heuristic: outflow from exchanges + rising active addresses = bullish tilt.
    const inflow = onChainMetrics.find((m) => m.metric === "exchange_inflow")?.value ?? null;
    const outflow = onChainMetrics.find((m) => m.metric === "exchange_outflow")?.value ?? null;
    let tilt = 0;
    if (inflow !== null && outflow !== null) {
      const net = outflow - inflow;
      tilt = Math.max(-1, Math.min(1, net / Math.max(1, inflow + outflow)));
    }
    onChainScore = Math.round(50 + tilt * 40);
  }

  const components: MarketIntelligenceComponents = {
    trend: clamp(trendScore),
    momentum: clamp(momentumScore),
    volatility: clamp(volatilityScore),
    volume: clamp(volumeScore),
    news: clamp(news.score),
    sentiment: clamp(sentiment.score),
    onChain: onChainScore !== null ? clamp(onChainScore) : null,
    regime: regime.regime,
  };

  const usedWeights = { ...WEIGHTS };
  if (components.onChain === null) {
    // Redistribute the on-chain weight proportionally rather than silently
    // treating "unavailable" as neutral 50 — that would fabricate a signal.
    const remaining = 1 - usedWeights.onChain;
    usedWeights.onChain = 0;
    (Object.keys(usedWeights) as (keyof typeof usedWeights)[]).forEach((k) => {
      if (k !== "onChain") usedWeights[k] = usedWeights[k] / remaining;
    });
  }

  const totalWeight = Object.values(usedWeights).reduce((a, b) => a + b, 0);
  const weightedSum =
    components.trend * usedWeights.trend +
    components.momentum * usedWeights.momentum +
    components.volatility * usedWeights.volatility +
    components.volume * usedWeights.volume +
    components.news * usedWeights.news +
    components.sentiment * usedWeights.sentiment +
    (components.onChain ?? 0) * usedWeights.onChain;

  const score = Math.round(weightedSum / totalWeight);

  // Data confidence blends structural data quality with how many
  // sub-signals actually had real data behind them.
  const availableSignals = [components.onChain !== null, news.totalArticles > 0, true, true].filter(Boolean).length;
  const dataConfidence = Math.round(dataQuality.score * 0.7 + (availableSignals / 4) * 30);

  return { score: clamp(score), components, dataConfidence: clamp(dataConfidence) };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}
