import { env } from "@/lib/env";
import { DemoMarketDataProvider } from "./market-data/demo-provider";
import { DemoNewsProvider } from "./news/demo-provider";
import { DemoSentimentProvider } from "./sentiment/demo-provider";
import { DemoOnChainProvider } from "./onchain/demo-provider";
import { DemoAIProvider } from "./ai/demo-provider";
import { AnthropicAIProvider } from "./ai/anthropic-provider";
import type { AIProvider, MarketDataProvider, NewsProvider, OnChainProvider, SentimentProvider } from "./types";

// Single place that decides "which concrete provider backs this
// interface right now". Swapping a real provider in later is a one-line
// change here — nothing else in the app needs to know.

let marketDataProvider: MarketDataProvider | null = null;
let newsProvider: NewsProvider | null = null;
let sentimentProvider: SentimentProvider | null = null;
let onChainProvider: OnChainProvider | null = null;
let aiProvider: AIProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (!marketDataProvider) {
    // Only "demo" is implemented today; this is where a CoinGecko/Binance
    // provider would be registered when isDemoMarketData is false.
    marketDataProvider = new DemoMarketDataProvider();
  }
  return marketDataProvider;
}

export function getNewsProvider(): NewsProvider {
  if (!newsProvider) newsProvider = new DemoNewsProvider();
  return newsProvider;
}

export function getSentimentProvider(): SentimentProvider {
  if (!sentimentProvider) sentimentProvider = new DemoSentimentProvider();
  return sentimentProvider;
}

export function getOnChainProvider(): OnChainProvider {
  if (!onChainProvider) onChainProvider = new DemoOnChainProvider();
  return onChainProvider;
}

export function getAIProvider(): AIProvider {
  if (!aiProvider) {
    aiProvider = env.hasAnthropicKey
      ? new AnthropicAIProvider(process.env.ANTHROPIC_API_KEY as string, env.aiModel)
      : new DemoAIProvider();
  }
  return aiProvider;
}
