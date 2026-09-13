import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 3 — Risk Level is now editable directly from the Dashboard (see
// RiskLevelSlider used on both dashboard/page.tsx and settings/page.tsx,
// both writing to the SAME PaperAccount.riskLevel via
// /api/settings/risk-profile — single source of truth, no separate
// "dashboard risk level" to go stale). The behavior that actually matters,
// and the one this test proves, is that a risk-level change takes effect
// on the very NEXT scan — no server restart, no bot-loop restart needed —
// because runPaperTradingScan re-reads `account.riskLevel` fresh every call.

const FIXED_ANALYST_OUTPUT: AIAnalystOutput = {
  signal: "LONG",
  confidence: 0.9,
  reasons: ["mock"],
  risks: [],
  invalidation_conditions: ["mock"],
  data_quality: 90,
  recommendation: "APPROVE",
};

const FIXED_CRITIC_OUTPUT: AICriticOutput = {
  verdict: "APPROVED",
  challengedReasons: [],
  biasesFound: [],
  overfittingConcern: false,
  notes: "mock: no objections",
};

const FIXED_STRATEGY: StrategyDefinition = {
  id: "mock-always-long",
  kind: "TREND_FOLLOWING",
  name: "Mock Always Long",
  version: "1.0",
  defaultParams: {},
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"],
  // 15% stop keeps full sizing well under maxConcentrationPct even at
  // riskLevel 10 (3% risk/trade / 15% stop = 20% of equity), so the
  // scenario isolates the risk-level effect instead of tripping RISK_CHECK.
  defaultStopLossPct: 15,
  defaultTakeProfitPct: 30,
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
    analyze: async () => ({ output: FIXED_ANALYST_OUTPUT, tokensIn: 0, tokensOut: 0, model: "mock" }),
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
const assetIds: string[] = [];
let accountId: string;

beforeAll(async () => {
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `risklevel-change-audit-${Date.now()}@example.com`, name: "Risk Level Change Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

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

  // Two distinct assets so the second scan's candidate isn't skipped by the
  // (asset, strategyVersion) existingPosition guard from the first scan.
  for (let i = 0; i < 2; i++) {
    const asset = await prisma.asset.create({ data: { symbol: `RLC${Date.now() % 100000}${i}`, name: `Risk Level Change Asset ${i}` } });
    assetIds.push(asset.id);
  }

  const account = await prisma.paperAccount.create({
    data: { userId, name: "Risk Level Change Audit Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 1 },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { accountId } });
  await prisma.positionStateChange.deleteMany({ where: { position: { accountId } } });
  await prisma.paperPosition.deleteMany({ where: { accountId } });
  await prisma.paperOrder.deleteMany({ where: { accountId } });
  await prisma.riskEvent.deleteMany({ where: { accountId } });
  await prisma.paperAccount.delete({ where: { id: accountId } });
  await prisma.aIAnalysis.deleteMany({ where: { assetId: { in: assetIds } } });
  await prisma.strategyVersion.delete({ where: { id: versionId } });
  await prisma.strategy.delete({ where: { id: strategyId } });
  for (const assetId of assetIds) {
    await prisma.asset.delete({ where: { id: assetId } });
  }
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: a Risk Level change takes effect on the very next scan (Fase 3)", () => {
  it("sizes positions per the OLD risk level, then per the NEW one immediately after an update — no restart needed", async () => {
    // First scan at riskLevel 1 (very conservative: 0.3% risk/trade).
    await runPaperTradingScan(accountId);
    const firstPositions = await prisma.paperPosition.findMany({ where: { accountId } });
    expect(firstPositions.length).toBe(1);
    const conservativeNotional = firstPositions[0].entryPrice * firstPositions[0].remainingQuantity;

    // Simulate exactly what the Dashboard/Settings RiskLevelSlider's POST to
    // /api/settings/risk-profile does: update PaperAccount.riskLevel directly.
    await prisma.paperAccount.update({ where: { id: accountId }, data: { riskLevel: 10 } });

    // Second scan, same process, no restart — must use the NEW risk level.
    await runPaperTradingScan(accountId);
    const allPositions = await prisma.paperPosition.findMany({ where: { accountId }, orderBy: { openedAt: "asc" } });
    expect(allPositions.length).toBe(2);
    const aggressiveNotional = allPositions[1].entryPrice * allPositions[1].remainingQuantity;

    // riskLevel 10 risks 3% per trade vs riskLevel 1's 0.3% — a 10x
    // difference in riskPerTradePct, so the aggressive position should be
    // dramatically larger, proving the change was picked up immediately.
    expect(aggressiveNotional).toBeGreaterThan(conservativeNotional * 5);
  });
});
