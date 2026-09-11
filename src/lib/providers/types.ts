/**
 * Provider abstractions (spec section 51 — PROVIDER ABSTRACTION).
 *
 * Nothing in the engines or UI should talk to a concrete data source
 * directly. They talk to these interfaces; `registry.ts` decides which
 * concrete implementation (demo or real) to hand back based on env config.
 * This is what lets us add more assets/providers later without touching
 * engine code, and what lets the whole app run with zero external APIs
 * in DEMO MODE.
 */

export type TimeframeCode = "M1" | "M5" | "M15" | "H1" | "H4" | "D1";

export interface OHLCVBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataResult {
  symbol: string;
  timeframe: TimeframeCode;
  bars: OHLCVBar[];
  source: string;
  isDemo: boolean;
  fetchedAt: Date;
}

export interface MarketDataProvider {
  readonly id: string;
  readonly isDemo: boolean;
  getOHLCV(symbol: string, timeframe: TimeframeCode, limit: number): Promise<MarketDataResult>;
  getLatestPrice(symbol: string): Promise<{ price: number; timestamp: Date } | null>;
}

export interface NewsItem {
  title: string;
  source: string;
  url?: string;
  publishedAt: Date;
  category:
    | "MACRO"
    | "REGULATION"
    | "EXCHANGE"
    | "PROTOCOL"
    | "ETF"
    | "SECURITY"
    | "ADOPTION"
    | "PARTNERSHIP"
    | "TECHNOLOGY"
    | "MARKET"
    | "OTHER";
  importance: number; // 0-100
  sentiment: number; // -1..1
  intensity: number; // 0-100
  entities: string[];
  assets: string[]; // symbols affected
  clusterKey?: string; // used for novelty/dedup
}

export interface NewsProvider {
  readonly id: string;
  readonly isDemo: boolean;
  getRecentNews(symbols: string[], limit: number): Promise<NewsItem[]>;
}

export interface SentimentPoint {
  symbol: string;
  timestamp: Date;
  score: number; // -1..1
}

export interface SentimentProvider {
  readonly id: string;
  readonly isDemo: boolean;
  getSentimentHistory(symbol: string, points: number): Promise<SentimentPoint[]>;
}

export type OnChainMetricName =
  | "exchange_inflow"
  | "exchange_outflow"
  | "whale_activity"
  | "active_addresses"
  | "transaction_volume"
  | "supply_on_exchanges"
  | "stablecoin_flows";

export interface OnChainMetricResult {
  symbol: string;
  metric: OnChainMetricName;
  timestamp: Date;
  value: number | null; // null => unavailable
  available: boolean;
}

export interface OnChainProvider {
  readonly id: string;
  readonly isDemo: boolean;
  getMetric(symbol: string, metric: OnChainMetricName): Promise<OnChainMetricResult>;
  getSupportedMetrics(): OnChainMetricName[];
}

export interface AIAnalystInput {
  symbol: string;
  timeframe: TimeframeCode;
  regime: string;
  indicators: Record<string, number | null>;
  marketIntelligence: number;
  news: { title: string; sentiment: number; importance: number }[];
  sentiment: { score: number; trend: number; divergence: boolean };
  onChain: Record<string, number | null>;
  strategySignal: { kind: string; direction: "LONG" | "SHORT"; strength: number };
  riskContext: { accountEquity: number; openExposurePct: number };
}

export interface AIAnalystOutput {
  signal: "LONG" | "SHORT" | "FLAT";
  confidence: number; // 0-1
  reasons: string[];
  risks: string[];
  invalidation_conditions: string[];
  data_quality: number; // 0-100
  recommendation: "APPROVE" | "LOW_CONFIDENCE" | "REJECT";
}

export interface AICriticInput {
  analyst: AIAnalystOutput;
  context: AIAnalystInput;
  historicalStrategyStats?: { trades: number; winRate: number; sharpe: number | null };
}

export interface AICriticOutput {
  verdict: "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED";
  challengedReasons: string[];
  biasesFound: string[];
  overfittingConcern: boolean;
  notes: string;
}

export interface AIProvider {
  readonly id: string;
  readonly isDemo: boolean;
  analyze(input: AIAnalystInput): Promise<{
    output: AIAnalystOutput;
    tokensIn: number;
    tokensOut: number;
    model: string;
  }>;
  critique(input: AICriticInput): Promise<{
    output: AICriticOutput;
    tokensIn: number;
    tokensOut: number;
    model: string;
  }>;
}
