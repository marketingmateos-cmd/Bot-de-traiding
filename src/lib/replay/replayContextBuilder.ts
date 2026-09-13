import type { NewsItem, OnChainMetricName, OnChainMetricResult, SentimentPoint } from "@/lib/providers/types";
import { summarizeNews, type NewsSummary } from "@/lib/engines/news";
import { analyzeSentiment, type SentimentAnalysis } from "@/lib/engines/sentiment";
import { gaussian, hashStringToSeed, mulberry32 } from "@/lib/providers/market-data/seeded-random";
import type { ReplayDataAvailability, ReplayDataSource } from "./types";

const ONCHAIN_METRICS: OnChainMetricName[] = [
  "exchange_inflow",
  "exchange_outflow",
  "whale_activity",
  "active_addresses",
  "transaction_volume",
  "supply_on_exchanges",
  "stablecoin_flows",
];

export interface ReplayIntelligenceContext {
  news: NewsSummary;
  sentiment: SentimentAnalysis;
  onChain: OnChainMetricResult[];
  availability: Pick<ReplayDataAvailability, "news" | "sentiment" | "onChain">;
}

/**
 * Fase 7 — news/sentiment/on-chain for a replay decision point.
 *
 * There is no real point-in-time archive for any of these three in this
 * system (the live "demo" providers in src/lib/providers/*\/demo-provider.ts
 * only ever generate an "as of right now" synthetic snapshot — see their
 * own doc comments; there has never been a real news/sentiment/on-chain
 * data vendor wired in, per providers/registry.ts). So:
 *
 *  - "HISTORICAL_REAL": always UNAVAILABLE — returning neutral/empty
 *    structures with every availability flag set to "UNAVAILABLE" rather
 *    than fabricating a plausible-looking history (spec rule #3).
 *  - "SYNTHETIC": a deterministic generator seeded by (symbol, timestamp)
 *    instead of Date.now(), so the SAME replay always reproduces the same
 *    synthetic news/sentiment/on-chain — useful for exercising the
 *    pipeline, but every value is tagged "SYNTHETIC" end to end and must
 *    never be presented as real historical evidence (spec rule #5).
 */
export function buildIntelligenceContext(symbol: string, atMs: number, priceChangePct: number, dataSource: ReplayDataSource): ReplayIntelligenceContext {
  if (dataSource === "HISTORICAL_REAL") {
    const unavailableOnChain: OnChainMetricResult[] = ONCHAIN_METRICS.map((metric) => ({
      symbol,
      metric,
      timestamp: new Date(atMs),
      value: null,
      available: false,
    }));
    return {
      news: summarizeNews([]),
      sentiment: analyzeSentiment([], priceChangePct),
      onChain: unavailableOnChain,
      availability: { news: "UNAVAILABLE", sentiment: "UNAVAILABLE", onChain: "UNAVAILABLE" },
    };
  }

  return {
    news: summarizeNews(generateSyntheticNews(symbol, atMs)),
    sentiment: analyzeSentiment(generateSyntheticSentimentHistory(symbol, atMs), priceChangePct),
    onChain: ONCHAIN_METRICS.map((metric) => generateSyntheticOnChain(symbol, metric, atMs)),
    availability: { news: "SYNTHETIC", sentiment: "SYNTHETIC", onChain: "SYNTHETIC" },
  };
}

function generateSyntheticNews(symbol: string, atMs: number): NewsItem[] {
  const bucket = Math.floor(atMs / (3 * 60 * 60_000));
  const rand = mulberry32(hashStringToSeed(`replay-news:${symbol}:${bucket}`));
  const count = 2 + Math.floor(rand() * 4);
  const items: NewsItem[] = [];
  for (let i = 0; i < count; i++) {
    const sentiment = (rand() - 0.5) * 1.6;
    items.push({
      title: `[SYNTHETIC] Evento de mercado sintético #${i + 1} para ${symbol}`,
      source: "Replay Sintético",
      publishedAt: new Date(atMs - Math.floor(rand() * 3 * 60 * 60_000)),
      category: "MARKET",
      importance: Math.round(40 + rand() * 60),
      sentiment: Math.max(-1, Math.min(1, sentiment)),
      intensity: Math.round(Math.abs(sentiment) * 60),
      entities: [symbol],
      assets: [symbol],
      clusterKey: `replay:${symbol}:${bucket}:${i}`,
    });
  }
  return items;
}

function generateSyntheticSentimentHistory(symbol: string, atMs: number): SentimentPoint[] {
  const bucket = Math.floor(atMs / (6 * 60 * 60_000));
  const rand = mulberry32(hashStringToSeed(`replay-sentiment:${symbol}:${bucket}`));
  const stepMs = 15 * 60_000;
  const points = 40;
  let score = (rand() - 0.5) * 0.6;
  const out: SentimentPoint[] = [];
  for (let i = points - 1; i >= 0; i--) {
    score = Math.max(-1, Math.min(1, score * 0.94 + gaussian(rand) * 0.05));
    out.push({ symbol, timestamp: new Date(atMs - i * stepMs), score });
  }
  return out;
}

function generateSyntheticOnChain(symbol: string, metric: OnChainMetricName, atMs: number): OnChainMetricResult {
  const bucket = Math.floor(atMs / (60 * 60_000));
  const rand = mulberry32(hashStringToSeed(`replay-onchain:${symbol}:${metric}:${bucket}`));
  let value: number;
  switch (metric) {
    case "exchange_inflow":
    case "exchange_outflow":
      value = 500 + rand() * 5000;
      break;
    case "whale_activity":
      value = rand() * 100;
      break;
    case "active_addresses":
      value = 10000 + rand() * 500000;
      break;
    case "transaction_volume":
      value = 1_000_000 + rand() * 500_000_000;
      break;
    case "supply_on_exchanges":
      value = 5 + rand() * 20;
      break;
    case "stablecoin_flows":
      value = (rand() - 0.4) * 200_000_000;
      break;
    default:
      value = rand() * 100;
  }
  return { symbol, metric, timestamp: new Date(atMs), value, available: true };
}
