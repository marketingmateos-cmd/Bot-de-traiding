import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import { multiTimeframeStrategy } from "@/lib/engines/strategy/multiTimeframe";
import { eventDrivenStrategy } from "@/lib/engines/strategy/eventDriven";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 1.A6 — regression test for a strategy-killing bug: runPaperTradingScan
// called `strategyDef.evaluate(bars, features, params, regime)` with only 4
// arguments, never the 5th `context` one. Multi-Timeframe and Event-Driven
// (see strategy/multiTimeframe.ts, strategy/eventDriven.ts) both
// structurally REQUIRE that context (`higherTimeframeTrend`, or
// `newsImpactScore`/`newsSentiment`) and return null without it — so both
// strategies were permanently dead in live paper trading, silently never
// producing a single signal, no matter how favorable the market.
//
// This test uses the REAL strategy definitions (not mocked, unlike the
// other paperTradingEngine integration tests) and a mocked orchestrator
// engineered to satisfy each strategy's specific requirement, then checks
// that a signal is actually produced — i.e. the candidate reaches at least
// NO_SIGNAL-vs-something-else territory, never silently NO_SIGNAL forever.

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

vi.mock("@/lib/providers/registry", () => ({
  getAIProvider: () => ({
    id: "mock",
    isDemo: true,
    analyze: async () => ({ output: FIXED_ANALYST_OUTPUT, tokensIn: 0, tokensOut: 0, model: "mock" }),
    critique: async () => ({ output: FIXED_CRITIC_OUTPUT, tokensIn: 0, tokensOut: 0, model: "mock" }),
  }),
}));

// Multi-Timeframe (H1 entry) needs an H4 read that agrees with, and is at
// least as strong as, the H1 trend for the same symbol — everything else
// (Event-Driven's news) is engineered to fail its own requirements on this
// symbol so only ONE strategy fires per test, isolating each fix.
const STRONG_TREND = 0.6;
vi.mock("@/lib/orchestrator", () => ({
  getSymbolAnalysis: async (symbol: string, timeframe: string) => ({
    symbol,
    timeframe,
    bars: [],
    isDemo: true,
    source: "mock",
    dataQuality: { score: 90, issues: [], blocksTrading: false },
    features: { close: 100, sma20: 100, sma50: 100, ema20: 100, rsi14: 55, macdHistogram: 0, atr14: 1, bbUpper: 105, bbLower: 95, volatility20: 0.01, volumeZScore20: 0, trend: STRONG_TREND, momentum: 0.3 },
    regime: { regime: "BULL", confidence: 0.8, details: { trendSlopePct: 1, volatilityPercentile: 40, rangeWidthPct: 2 } },
    news: {
      score: 60,
      topStories: [
        { title: "High-impact story", source: "mock", publishedAt: new Date(), category: "MARKET", importance: 90, sentiment: 0.8, intensity: 80, entities: [], assets: [symbol], impactScore: 92, noveltyScore: 100 },
      ],
      clusterCount: 1,
      totalArticles: 1,
    },
    sentiment: { current: 0.2, trend: 0.1, acceleration: 0, divergence: false, divergenceMagnitude: 0, score: 60 },
    onChain: [{ symbol, metric: "whale_activity", timestamp: new Date(), value: 1, available: true }],
    marketIntelligence: { score: 75 },
    priceChangePct: 2,
    latestPrice: 100,
  }),
}));

// Real strategy registry (getStrategyById is NOT mocked here) so the actual
// production evaluate() functions run against the injected context.
const strategyModule = await import("@/lib/engines/strategy");
vi.spyOn(strategyModule, "getStrategyById").mockImplementation((id: string) => {
  if (id === "multi-timeframe") return multiTimeframeStrategy;
  if (id === "event-driven") return eventDrivenStrategy;
  return undefined;
});

const { runPaperTradingScan } = await import("@/lib/paperTradingEngine");

let userId: string;
const strategyIds: string[] = [];
const versionIds: string[] = [];
let assetId: string;
let accountId: string;

beforeAll(async () => {
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `strategy-context-audit-${Date.now()}@example.com`, name: "Strategy Context Audit" } });
  userId = user.id;

  const asset = await prisma.asset.create({ data: { symbol: `CTX${Date.now() % 100000}`, name: "Strategy Context Audit Asset" } });
  assetId = asset.id;

  const allRegimes = toJson(["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"]);

  for (const kind of ["MULTI_TIMEFRAME", "EVENT_DRIVEN"] as const) {
    const strategy = await prisma.strategy.create({ data: { kind, name: `Real ${kind}` } });
    strategyIds.push(strategy.id);
    const version = await prisma.strategyVersion.create({
      data: {
        strategyId: strategy.id,
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
    versionIds.push(version.id);
  }

  const account = await prisma.paperAccount.create({
    data: { userId, name: "Strategy Context Audit Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 8 },
  });
  accountId = account.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.trade.deleteMany({ where: { accountId } });
  await prisma.positionStateChange.deleteMany({ where: { position: { accountId } } });
  await prisma.paperPosition.deleteMany({ where: { accountId } });
  await prisma.paperOrder.deleteMany({ where: { accountId } });
  await prisma.paperAccount.delete({ where: { id: accountId } });
  await prisma.aIAnalysis.deleteMany({ where: { assetId } });
  for (const strategyId of strategyIds) {
    await prisma.strategyVersion.deleteMany({ where: { strategyId } });
    await prisma.strategy.delete({ where: { id: strategyId } });
  }
  await prisma.asset.delete({ where: { id: assetId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: Multi-Timeframe and Event-Driven can produce a signal in live paper trading (Fase 1.A6)", () => {
  it("neither strategy is permanently dead for lack of a context argument", async () => {
    const results = await runPaperTradingScan(accountId);

    const mtfResult = results.find((r) => r.strategyVersionId === versionIds[0]);
    const eventResult = results.find((r) => r.strategyVersionId === versionIds[1]);

    expect(mtfResult).toBeDefined();
    expect(eventResult).toBeDefined();

    // Before the fix, BOTH would be NO_SIGNAL forever regardless of how
    // favorable the constructed scenario is, because evaluate() always
    // received `context === undefined` and both strategies hard-require it.
    expect(mtfResult!.verdict).not.toBe("NO_SIGNAL");
    expect(mtfResult!.signal).not.toBeNull();
    expect(mtfResult!.signal!.direction).toBe("LONG"); // STRONG_TREND > 0

    expect(eventResult!.verdict).not.toBe("NO_SIGNAL");
    expect(eventResult!.signal).not.toBeNull();
    expect(eventResult!.signal!.direction).toBe("LONG"); // sentiment 0.8 > 0
  });
});
