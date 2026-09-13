import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";

// Fase 1.A5 — regression test for the Critic having NO budget/cache gating
// at all in runPaperTradingScan (unlike the Analyst, which at least fell
// back to cache-only once the budget was exhausted). With the daily AI
// budget genuinely exhausted, the fix must degrade to a conservative,
// clearly-labeled fallback for BOTH Analyst and Critic — never call the
// provider again, and never silently approve just because AI is
// unavailable. A position may still open (at LOW_CONFIDENCE / half size),
// since a bot correctly configured to trade cautiously without a fresh AI
// opinion is the whole point of graceful degradation — but it must never
// be treated as a full APPROVE.

process.env.AI_DAILY_CALL_BUDGET = "0"; // forces shouldUseCacheOnly=true unconditionally (0 calls today >= a budget of 0), regardless of any other test's accumulated usage for "today"

let analyzeCalls = 0;
let critiqueCalls = 0;

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
      throw new Error("should never be called — budget is exhausted, the fallback must be used instead");
    },
    critique: async () => {
      critiqueCalls++;
      throw new Error("should never be called — budget is exhausted, the fallback must be used instead");
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

// Imported AFTER the env override and mocks above, so both take effect
// (env.ts reads process.env once at module import time).
const { runPaperTradingScan } = await import("@/lib/paperTradingEngine");

let userId: string;
let strategyId: string;
let versionId: string;
let assetId: string;
let accountId: string;

beforeAll(async () => {
  // runPaperTradingScan scans every ACTIVE strategy version × asset in the
  // whole DB by design — deactivate any pre-existing rows so this test only
  // ever sees its own fixture, regardless of other test files' leftovers in
  // this shared test DB.
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `ai-exhausted-audit-${Date.now()}@example.com`, name: "AI Exhausted Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

  const asset = await prisma.asset.create({ data: { symbol: `AIEXH${Date.now() % 100000}`, name: "AI Exhausted Audit Asset" } });
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
    data: { userId, name: "AI Exhausted Audit Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 6 },
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

describe("AUDIT: runPaperTradingScan degrades to a conservative fallback when the AI budget is exhausted (Fase 1.A5)", () => {
  it("never calls the AI provider once the budget is exhausted, and never silently full-approves without it", async () => {
    const results = await runPaperTradingScan(accountId);

    // The provider must never be invoked — this is the core of the bug:
    // the Critic previously had no budget gating whatsoever and would have
    // called out regardless.
    expect(analyzeCalls).toBe(0);
    expect(critiqueCalls).toBe(0);

    expect(results.length).toBeGreaterThan(0);
    const candidate = results[0];
    // A brand-new strategy version always fails ROBUSTNESS_CHECK (zero
    // trade history) in addition to the AI fallback's own downgrade, so the
    // verdict is LOW_CONFIDENCE, never a full APPROVED rubber-stamp.
    expect(candidate.verdict).not.toBe("APPROVED");
    expect(candidate.verdict).not.toBe("BLOCKED");
    expect(candidate.verdict).toBe("LOW_CONFIDENCE");

    // It should still trade cautiously rather than freeze up entirely —
    // graceful degradation, not a full stop.
    const openPositions = await prisma.paperPosition.findMany({ where: { accountId, status: "OPEN" } });
    expect(openPositions.length).toBe(1);

    const aiAnalyses = await prisma.aIAnalysis.findMany({ where: { assetId } });
    expect(aiAnalyses.every((a) => a.model === "budget-exhausted-fallback")).toBe(true);
  });
});
