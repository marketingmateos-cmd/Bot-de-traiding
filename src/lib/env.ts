/**
 * Central, typed access to environment configuration. Keeps the "which
 * provider / demo mode" decisions in one place instead of scattering
 * process.env reads across the codebase.
 */

export const env = {
  appEnv: (process.env.APP_ENV ?? "dev") as "dev" | "test" | "production",
  isDemoMarketData: (process.env.MARKET_DATA_PROVIDER ?? "demo") === "demo",
  isDemoNews: (process.env.NEWS_PROVIDER ?? "demo") === "demo",
  isDemoSentiment: (process.env.SENTIMENT_PROVIDER ?? "demo") === "demo",
  isDemoOnChain: (process.env.ONCHAIN_PROVIDER ?? "demo") === "demo",
  hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
  aiModel: process.env.AI_MODEL ?? "claude-sonnet-5",
  aiDailyCallBudget: Number(process.env.AI_DAILY_CALL_BUDGET ?? 200),
  aiMonthlyCostBudgetUsd: Number(process.env.AI_MONTHLY_COST_BUDGET_USD ?? 20),
  defaultRiskProfile: (process.env.DEFAULT_RISK_PROFILE ?? "BALANCED") as
    | "CONSERVATIVE"
    | "BALANCED"
    | "AGGRESSIVE"
    | "CUSTOM",
};

export const SUPPORTED_ASSETS = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "XRP", name: "XRP" },
  { symbol: "BNB", name: "BNB" },
  { symbol: "DOGE", name: "Dogecoin" },
  { symbol: "ADA", name: "Cardano" },
] as const;
