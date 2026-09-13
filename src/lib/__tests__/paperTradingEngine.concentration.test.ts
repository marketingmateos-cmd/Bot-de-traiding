import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 1.A4 — regression test for the missing cross-strategy, same-asset
// concentration guard in runPaperTradingScan. Before this fix, the only
// per-candidate duplicate guard was `existingPosition` in
// src/lib/paperTradingEngine.ts, scoped to (assetId, strategyVersionId) —
// it never stopped several DIFFERENT strategy versions from each
// independently opening a position on the SAME asset. Each stayed within
// the account's aggregate exposure limit while their combined bet on that
// one asset did not, concentrating risk the aggregate check alone can't see.
//
// The fix adds a per-asset concentration cap (`maxConcentrationPct` in
// riskEngine.ts) that sums notional across ALL strategies on one asset, not
// just the candidate's own. This test forces several distinct strategy
// versions to all signal on the SAME single asset and checks the combined
// bet on it never exceeds the account's maxConcentrationPct — something the
// aggregate-only exposure check would have let through.

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

// riskLevel 10: riskPerTradePct 3%, maxExposurePct 90% (generous — this test
// isolates CONCENTRATION, not aggregate exposure), maxConcentrationPct 45%.
// A 15% stop with 3% risk-per-trade sizes each FULL candidate at ~20% of
// equity; at the guaranteed LOW_CONFIDENCE half-size (fresh strategy
// versions always have zero trade history) that's a clean ~10% actually
// added per opened position — several of these on the SAME asset should
// still be capped well before reaching the 90% aggregate limit.
const FIXED_STRATEGY: StrategyDefinition = {
  id: "mock-always-long",
  kind: "TREND_FOLLOWING",
  name: "Mock Always Long",
  version: "1.0",
  defaultParams: {},
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"],
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

// Imported AFTER the mocks above so it picks up the mocked modules.
const { runPaperTradingScan } = await import("@/lib/paperTradingEngine");

let userId: string;
let strategyId: string;
const versionIds: string[] = [];
let assetId: string;
let accountId: string;

// Enough distinct strategy VERSIONS all targeting the SAME asset that, at
// ~10% actual notional each, their combined bet would clearly blow past the
// 45% per-asset concentration cap if nothing aggregated across strategies.
const NUM_VERSIONS = 6;

beforeAll(async () => {
  // runPaperTradingScan scans every ACTIVE strategy version × asset in the
  // whole DB by design — deactivate any pre-existing rows so this test only
  // ever sees its own fixtures, regardless of other test files' leftovers
  // in this shared test DB.
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `concentration-audit-${Date.now()}@example.com`, name: "Concentration Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

  const asset = await prisma.asset.create({ data: { symbol: `CONC${Date.now() % 100000}`, name: "Concentration Audit Asset" } });
  assetId = asset.id;

  const allRegimes = toJson(["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"]);

  for (let i = 0; i < NUM_VERSIONS; i++) {
    const version = await prisma.strategyVersion.create({
      data: {
        strategyId,
        version: `1.${i}`,
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
    data: { userId, name: "Concentration Audit Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 10 },
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
  await prisma.aIAnalysis.deleteMany({ where: { assetId } });
  await prisma.strategyVersion.deleteMany({ where: { strategyId } });
  await prisma.strategy.delete({ where: { id: strategyId } });
  await prisma.asset.delete({ where: { id: assetId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: runPaperTradingScan caps per-asset concentration across different strategies (Fase 1.A4)", () => {
  it("never lets several different strategy versions combine to exceed maxConcentrationPct on the same single asset", async () => {
    await runPaperTradingScan(accountId);

    const openPositions = await prisma.paperPosition.findMany({ where: { accountId, assetId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
    const account = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });

    const assetNotional = openPositions.reduce((sum, p) => sum + p.entryPrice * p.remainingQuantity, 0);
    const concentrationPct = (assetNotional / account.startingBalance) * 100;

    // With the bug, every one of the 6 different strategy versions passes
    // its own exposure/concentration check independently (each looks fine
    // in isolation), so all 6 would open on this one asset at ~10% actual
    // each — a real concentration of ~60%, blowing past the 45% cap. With
    // the fix, only as many open as fit under that 45% cap before the next
    // candidate on this same asset is correctly BLOCKED by RISK_CHECK.
    expect(concentrationPct).toBeLessThanOrEqual(45 + 1e-6);
    expect(openPositions.length).toBeGreaterThan(0);
    expect(openPositions.length).toBeLessThan(NUM_VERSIONS);
  });

  it("records a RiskEvent for every candidate blocked by the concentration cap (Fase 2 — RiskEvent was previously a dead table)", async () => {
    const riskEvents = await prisma.riskEvent.findMany({ where: { accountId } });
    expect(riskEvents.length).toBeGreaterThan(0);
    expect(riskEvents.every((e) => e.kind === "CONCENTRATION")).toBe(true);
    expect(riskEvents.every((e) => e.severity === "WARN")).toBe(true);
    expect(riskEvents.every((e) => e.message.toLowerCase().includes("concentración"))).toBe(true);
  });
});
