import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 1.A5 — regression test for the "backwards" AI cache in
// runPaperTradingScan. Before the fix, the cache was only ever consulted
// once the daily AI budget was ALREADY exhausted
// (`budget.shouldUseCacheOnly ? getCached(...) : null`), so with a healthy
// budget — the normal case — every single candidate paid for a fresh
// Analyst call regardless of whether an identical analysis had just been
// computed, and the Critic had NO caching at all. This defeated the entire
// purpose of the cache (spec §36: avoid re-spending budget on an unchanged
// setup) during ordinary, well-within-budget operation.
//
// This test forces the SAME candidate (same asset/strategy/regime/signal,
// hence the same cache key) to be evaluated across two separate scans, with
// a spy AI provider, and checks the provider is only actually invoked once
// — the second scan should hit the cache. The candidate is deliberately
// engineered to never actually open a position (zero equity forces
// RISK_CHECK to block every time), so `existingPosition` never short-
// circuits the second scan and the Analyst/Critic are genuinely
// re-evaluated each time — isolating the cache behavior specifically.

let analyzeCalls = 0;
let critiqueCalls = 0;

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
    analyze: async () => {
      analyzeCalls++;
      return { output: FIXED_ANALYST_OUTPUT, tokensIn: 100, tokensOut: 50, model: "mock" };
    },
    critique: async () => {
      critiqueCalls++;
      return { output: FIXED_CRITIC_OUTPUT, tokensIn: 80, tokensOut: 40, model: "mock" };
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

// Imported AFTER the mocks above so it picks up the mocked modules.
const { runPaperTradingScan } = await import("@/lib/paperTradingEngine");

let userId: string;
let strategyId: string;
let versionId: string;
let assetId: string;
let accountId: string;

beforeAll(async () => {
  // runPaperTradingScan scans every ACTIVE strategy version × asset in the
  // whole DB by design (a real deployment has one account against the
  // system's full strategy/asset universe) — deactivate any pre-existing
  // rows so this test's mocked provider spy only ever sees its own fixture,
  // regardless of what other test files have left in this shared test DB.
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `ai-cache-audit-${Date.now()}@example.com`, name: "AI Cache Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

  const asset = await prisma.asset.create({ data: { symbol: `AICACHE${Date.now() % 100000}`, name: "AI Cache Audit Asset" } });
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

  // Zero equity forces RISK_CHECK to block every candidate outright (100%
  // "exposure" against zero equity), so no position is ever opened and
  // `existingPosition` never short-circuits a later scan — the Analyst/
  // Critic genuinely get a chance to run (or hit cache) on every scan.
  const account = await prisma.paperAccount.create({
    data: { userId, name: "AI Cache Audit Account", startingBalance: 0, cashBalance: 0, riskLevel: 6 },
  });
  accountId = account.id;

  // The AIUsage "today" row is real, shared, persistent state across every
  // test (and every manual run) in this DB — reset it so this test's budget
  // is deterministically healthy (shouldUseCacheOnly=false), regardless of
  // how many calls other tests/runs have already recorded for today.
  const todayStartUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  await prisma.aIUsage.deleteMany({ where: { day: todayStartUtc } });
});

afterAll(async () => {
  await prisma.paperOrder.deleteMany({ where: { accountId } });
  await prisma.paperAccount.delete({ where: { id: accountId } });
  await prisma.aIAnalysis.deleteMany({ where: { assetId } });
  await prisma.strategyVersion.delete({ where: { id: versionId } });
  await prisma.strategy.delete({ where: { id: strategyId } });
  await prisma.asset.delete({ where: { id: assetId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: runPaperTradingScan checks the AI cache first even with a healthy budget (Fase 1.A5)", () => {
  it("only calls the AI provider once across two scans of the identical candidate — the second hits cache", async () => {
    await runPaperTradingScan(accountId);
    expect(analyzeCalls).toBe(1);
    expect(critiqueCalls).toBe(1);

    await runPaperTradingScan(accountId);
    // With the bug, this second scan would call the provider again
    // (analyzeCalls/critiqueCalls -> 2) because the cache was never
    // consulted while the budget was healthy. With the fix, it's a cache hit.
    expect(analyzeCalls).toBe(1);
    expect(critiqueCalls).toBe(1);
  });
});
