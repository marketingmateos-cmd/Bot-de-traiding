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
  /**
   * MT5 DEMO data connector — the environment-level execution kill switch
   * (not a secret, safe in this shared object). Defaults to false whenever
   * unset, missing, or set to anything other than the literal string
   * "true" — there is no way to enable it by omission. This is an
   * ADDITIONAL, independent precondition on top of the existing DB-backed
   * `MT5DemoConnection.executionEnabled` Safety Switch
   * (see demoAccountGuard.ts's canEnableMt5Execution) — both must agree
   * before any order can ever be placed. It stays false for the entire
   * MT5 Data Connector phase; nothing in this codebase ever sets it.
   *
   * A live getter (re-read on every access), unlike the plain-value fields
   * above — a kill switch that only ever reflected `process.env` at module
   * load time could never be exercised by a test that flips it per-case
   * (and, more importantly, could disagree with the actual environment if
   * that ever changed at runtime without a process restart).
   */
  get isDemoExecutionEnabledByEnv(): boolean {
    return (process.env.ENABLE_DEMO_EXECUTION ?? "false").trim().toLowerCase() === "true";
  },
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
