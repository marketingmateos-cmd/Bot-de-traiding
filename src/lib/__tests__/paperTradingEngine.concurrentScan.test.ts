import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 1.A7 — regression test for the missing lock between a manual scan
// (POST /api/paper-trading/scan) and the autonomous bot loop, both of which
// call runPaperTradingScan for the SAME account with nothing previously
// stopping them from running concurrently. Two interleaved scans would each
// read `openPositions` independently before either commits its own writes,
// so both could pass the SAME `existingPosition` / exposure checks and both
// end up opening a position for the same (asset, strategyVersion) pair —
// exactly the duplicate-position failure mode the position-state-manager
// reconciliation elsewhere is designed to catch AFTER the fact, but that
// should never be reachable in the first place from a single account's own
// scans.
//
// The orchestrator/AI layers are mocked to a slow-but-deterministic
// candidate (one asset, one version, always LONG) so two overlapping calls
// to runPaperTradingScan have a real window to race in.

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
    // A small artificial delay widens the race window between two
    // concurrent scans reading `openPositions` before either commits.
    analyze: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { output: FIXED_ANALYST_OUTPUT, tokensIn: 0, tokensOut: 0, model: "mock" };
    },
    critique: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { output: FIXED_CRITIC_OUTPUT, tokensIn: 0, tokensOut: 0, model: "mock" };
    },
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
let accountId: string;

beforeAll(async () => {
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `concurrent-scan-audit-${Date.now()}@example.com`, name: "Concurrent Scan Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

  const asset = await prisma.asset.create({ data: { symbol: `RACE${Date.now() % 100000}`, name: "Concurrent Scan Audit Asset" } });
  assetId = asset.id;

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
    data: { userId, name: "Concurrent Scan Audit Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 6 },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { accountId } });
  await prisma.positionStateChange.deleteMany({ where: { position: { accountId } } });
  await prisma.paperPosition.deleteMany({ where: { accountId } });
  await prisma.paperOrder.deleteMany({ where: { accountId } });
  await prisma.paperAccount.delete({ where: { id: accountId } });
  await prisma.aIAnalysis.deleteMany({ where: { assetId } });
  await prisma.strategyVersion.delete({ where: { id: versionId } });
  await prisma.strategy.delete({ where: { id: strategyId } });
  await prisma.asset.delete({ where: { id: assetId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: runPaperTradingScan is safe against concurrent manual + autonomous scans on the same account (Fase 1.A7)", () => {
  it("never opens duplicate positions for the same (asset, strategyVersion) pair when two scans are fired concurrently", async () => {
    const [resultsA, resultsB] = await Promise.all([runPaperTradingScan(accountId), runPaperTradingScan(accountId)]);

    // The second caller should join the first's in-flight scan rather than
    // running an independent one — same result reference/content for both.
    expect(resultsB).toEqual(resultsA);

    const openPositions = await prisma.paperPosition.findMany({
      where: { accountId, assetId, strategyVersionId: versionId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } },
    });
    // With the bug, both concurrent scans could independently pass the
    // `existingPosition` check (each seeing zero open positions at read
    // time, before the other commits) and both open a position for the
    // exact same (asset, strategyVersion) — reconcilePositions would later
    // find this and block the WHOLE account. With the fix, only one scan
    // ever actually runs at a time for this account.
    expect(openPositions.length).toBeLessThanOrEqual(1);

    const reconciliation = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(reconciliation.isTradingBlocked).toBe(false);
  });
});
