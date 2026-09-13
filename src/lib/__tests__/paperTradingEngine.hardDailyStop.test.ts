import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 6 — Daily Profit Protection: HARD_DAILY_STOP must block ALL new
// trades outright, with no exception, once today's real (realized) P&L
// hits the configured hard floor — driven purely by the account's own
// equity numbers, never an AI opinion. This test simulates a big loss
// already realized TODAY (via a real Trade row, exactly like a live loss
// would be recorded) and confirms the scan opens nothing at all — not even
// evaluating candidates far enough to spend AI budget on them.

let analyzeCalls = 0;

const FIXED_ANALYST_OUTPUT: AIAnalystOutput = {
  signal: "LONG",
  confidence: 0.99,
  reasons: ["mock"],
  risks: [],
  invalidation_conditions: ["mock"],
  data_quality: 100,
  recommendation: "APPROVE",
};

const FIXED_CRITIC_OUTPUT: AICriticOutput = {
  verdict: "APPROVED",
  challengedReasons: [],
  biasesFound: [],
  overfittingConcern: false,
  notes: "mock",
};

const FIXED_STRATEGY: StrategyDefinition = {
  id: "mock-always-long",
  kind: "TREND_FOLLOWING",
  name: "Mock Always Long",
  version: "1.0",
  defaultParams: {},
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"],
  defaultStopLossPct: 5,
  defaultTakeProfitPct: 10,
  defaultTrailingStopPct: null,
  costModel: { feeBps: 10, slippageBps: 5 },
  evaluate: () => ({ kind: "TREND_FOLLOWING", direction: "LONG", strength: 1, reason: "mock: always long" }),
};

vi.mock("@/lib/engines/strategy", () => ({
  getStrategyById: () => FIXED_STRATEGY,
}));

vi.mock("@/lib/providers/registry", () => ({
  getAIProvider: () => ({
    id: "mock",
    isDemo: true,
    analyze: async () => {
      analyzeCalls++;
      return { output: FIXED_ANALYST_OUTPUT, tokensIn: 0, tokensOut: 0, model: "mock" };
    },
    critique: async () => ({ output: FIXED_CRITIC_OUTPUT, tokensIn: 0, tokensOut: 0, model: "mock" }),
  }),
}));

vi.mock("@/lib/orchestrator", () => ({
  getSymbolAnalysis: async (symbol: string) => ({
    symbol,
    timeframe: "H1",
    bars: [],
    isDemo: true,
    source: "mock",
    dataQuality: { score: 90, issues: [], blocksTrading: false },
    features: { close: 100, sma20: 100, sma50: 100, ema20: 100, rsi14: 55, macdHistogram: 0, atr14: 1, bbUpper: 105, bbLower: 95, volatility20: 0.01, volumeZScore20: 0, trend: 0.5, momentum: 0.3 },
    regime: { regime: "BULL", confidence: 0.8, details: { trendSlopePct: 1, volatilityPercentile: 40, rangeWidthPct: 2 } },
    news: { score: 60, topStories: [], clusterCount: 0, totalArticles: 0 },
    sentiment: { current: 0.2, trend: 0.1, acceleration: 0, divergence: false, divergenceMagnitude: 0, score: 60 },
    onChain: [{ symbol, metric: "whale_activity", timestamp: new Date(), value: 1, available: true }],
    marketIntelligence: { score: 75 },
    priceChangePct: 2,
    latestPrice: 100,
  }),
}));

const { runPaperTradingScan } = await import("@/lib/paperTradingEngine");

let userId: string;
let strategyId: string;
let versionId: string;
let assetId: string;
let lossAssetId: string;
let accountId: string;

beforeAll(async () => {
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `hard-daily-stop-audit-${Date.now()}@example.com`, name: "Hard Daily Stop Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

  const suffix = Date.now() % 100000;
  const asset = await prisma.asset.create({ data: { symbol: `HDS${suffix}`, name: "Hard Daily Stop Asset" } });
  assetId = asset.id;
  const lossAsset = await prisma.asset.create({ data: { symbol: `HDSLOSS${suffix}`, name: "Loss-recording asset" } });
  lossAssetId = lossAsset.id;

  const allRegimes = toJson(["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"]);
  const version = await prisma.strategyVersion.create({
    data: {
      strategyId,
      version: "1.0",
      parameters: toJson({}),
      timeframe: "H1",
      allowedMarkets: toJson([]),
      recommendedRegimes: allRegimes,
      entryRules: toJson({}),
      exitRules: toJson({}),
      filters: toJson({}),
      costModel: toJson({ feeBps: 10, slippageBps: 5 }),
    },
  });
  versionId = version.id;

  const account = await prisma.paperAccount.create({
    data: { userId, name: "Hard Daily Stop Audit Account", startingBalance: 10000, cashBalance: 9400, riskLevel: 6 },
  });
  accountId = account.id;

  // Record a real -6% loss realized TODAY (closedAt = now), exactly as a
  // live losing trade would be recorded — this is what should drive the
  // state machine into HARD_DAILY_STOP (default hardStopLossPct = -5%).
  const position = await prisma.paperPosition.create({
    data: {
      accountId,
      assetId: lossAssetId,
      direction: "LONG",
      status: "CLOSED",
      entryPrice: 100,
      quantity: 60,
      remainingQuantity: 0,
      openedAt: new Date(Date.now() - 3600_000),
      closedAt: new Date(),
      snapshot: toJson({}),
    },
  });
  await prisma.trade.create({
    data: {
      accountId,
      positionId: position.id,
      assetId: lossAssetId,
      direction: "LONG",
      entryPrice: 100,
      exitPrice: 90,
      quantity: 60,
      fees: 0,
      slippageCost: 0,
      grossPnl: -600,
      netPnl: -600,
      mae: 0.1,
      mfe: 0,
      durationSeconds: 3600,
      exitReason: "STOP_LOSS",
      openedAt: new Date(Date.now() - 3600_000),
      closedAt: new Date(),
    },
  });

  await prisma.profitProtectionConfig.upsert({
    where: { id: "main" },
    update: { hardStopLossPct: -5, profitProtectionTriggerPct: 3, lastState: "NORMAL" },
    create: { id: "main", accountId, hardStopLossPct: -5, profitProtectionTriggerPct: 3 },
  });
});

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { accountId } });
  await prisma.positionStateChange.deleteMany({ where: { position: { accountId } } });
  await prisma.paperPosition.deleteMany({ where: { accountId } });
  await prisma.paperOrder.deleteMany({ where: { accountId } });
  await prisma.riskEvent.deleteMany({ where: { accountId } });
  await prisma.systemAlert.deleteMany({ where: { kind: "DAILY_PROFIT_PROTECTION" } });
  await prisma.paperAccount.delete({ where: { id: accountId } });
  await prisma.aIAnalysis.deleteMany({ where: { assetId: { in: [assetId, lossAssetId] } } });
  await prisma.strategyVersion.delete({ where: { id: versionId } });
  await prisma.strategy.delete({ where: { id: strategyId } });
  await prisma.asset.delete({ where: { id: assetId } });
  await prisma.asset.delete({ where: { id: lossAssetId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: HARD_DAILY_STOP blocks every new trade, no exception (Fase 6)", () => {
  it("opens nothing and never even spends AI budget once today's realized loss hits the hard floor", async () => {
    const results = await runPaperTradingScan(accountId);

    // Short-circuited before any candidate was evaluated — real budget saved.
    expect(results).toHaveLength(0);
    expect(analyzeCalls).toBe(0);

    const openPositions = await prisma.paperPosition.findMany({ where: { accountId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
    expect(openPositions).toHaveLength(0);

    const alert = await prisma.systemAlert.findFirst({ where: { kind: "DAILY_PROFIT_PROTECTION" }, orderBy: { createdAt: "desc" } });
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("CRITICAL");

    const config = await prisma.profitProtectionConfig.findUniqueOrThrow({ where: { id: "main" } });
    expect(config.lastState).toBe("HARD_DAILY_STOP");
  });

  it("does not re-alert on a second scan while still in the same state (transition-only alerting)", async () => {
    const alertsBefore = await prisma.systemAlert.count({ where: { kind: "DAILY_PROFIT_PROTECTION" } });
    await runPaperTradingScan(accountId);
    const alertsAfter = await prisma.systemAlert.count({ where: { kind: "DAILY_PROFIT_PROTECTION" } });
    expect(alertsAfter).toBe(alertsBefore);
  });
});
