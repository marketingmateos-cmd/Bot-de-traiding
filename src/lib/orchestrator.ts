import { getMarketDataProvider, getNewsProvider, getOnChainProvider, getSentimentProvider } from "@/lib/providers/registry";
import type { OnChainMetricName, TimeframeCode } from "@/lib/providers/types";
import { evaluateDataQuality } from "@/lib/engines/dataQuality";
import { computeLatestFeatures } from "@/lib/engines/features";
import { detectRegime } from "@/lib/engines/regime";
import { summarizeNews } from "@/lib/engines/news";
import { analyzeSentiment } from "@/lib/engines/sentiment";
import { computeMarketIntelligence } from "@/lib/engines/marketIntelligence";

const ONCHAIN_METRICS: OnChainMetricName[] = [
  "exchange_inflow",
  "exchange_outflow",
  "whale_activity",
  "active_addresses",
  "transaction_volume",
  "supply_on_exchanges",
  "stablecoin_flows",
];

/**
 * Central "give me everything the lab currently knows about this symbol"
 * call. Every screen that shows market/intelligence data goes through this
 * so the numbers are always internally consistent between, say, the
 * Dashboard and the Markets screen.
 */
export async function getSymbolAnalysis(symbol: string, timeframe: TimeframeCode = "H1") {
  const marketProvider = getMarketDataProvider();
  const newsProvider = getNewsProvider();
  const sentimentProvider = getSentimentProvider();
  const onChainProvider = getOnChainProvider();

  const [marketResult, newsItems, sentimentHistory, ...onChainResults] = await Promise.all([
    marketProvider.getOHLCV(symbol, timeframe, 400),
    newsProvider.getRecentNews([symbol], 20),
    sentimentProvider.getSentimentHistory(symbol, 60),
    ...ONCHAIN_METRICS.map((m) => onChainProvider.getMetric(symbol, m)),
  ]);

  const dataQuality = evaluateDataQuality(marketResult.bars, timeframe);
  const features = computeLatestFeatures(marketResult.bars);
  const regime = detectRegime(marketResult.bars);
  const news = summarizeNews(newsItems);

  const bars = marketResult.bars;
  const priceChangePct =
    bars.length > 20 ? ((bars[bars.length - 1].close - bars[bars.length - 20].close) / bars[bars.length - 20].close) * 100 : 0;
  const sentiment = analyzeSentiment(sentimentHistory, priceChangePct);

  const marketIntelligence = features
    ? computeMarketIntelligence(features, regime, news, sentiment, onChainResults, dataQuality)
    : null;

  return {
    symbol,
    timeframe,
    bars,
    isDemo: marketResult.isDemo,
    source: marketResult.source,
    dataQuality,
    features,
    regime,
    news,
    sentiment,
    onChain: onChainResults,
    marketIntelligence,
    priceChangePct,
    latestPrice: bars.length ? bars[bars.length - 1].close : null,
  };
}

export type SymbolAnalysis = Awaited<ReturnType<typeof getSymbolAnalysis>>;
