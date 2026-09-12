import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 1.A3 — regression test for the stale `openNotional` bug in
// runPaperTradingScan (src/lib/paperTradingEngine.ts). Before the fix,
// `openNotional` was computed ONCE before the candidate loop (from the
// positions that were ALREADY open before this scan started) and never
// updated as new positions opened DURING the same scan — so every exposure
// check after the first candidate compared against a stale (too-low)
// notional, letting total exposure silently compound past the account's own
// maxExposurePct limit within a single scan cycle.
//
// The strategy/AI/orchestrator layers are mocked to fixed, deterministic
// outputs so this test isolates the actual bug site: the risk-accounting
// loop inside runPaperTradingScan. Everything else (DB, risk engine, trade
// gate, position state manager) is real. A brand-new strategy version always
// has zero trade history, so ROBUSTNESS_CHECK always downgrades to
// LOW_CONFIDENCE (half execution size) regardless of anything else — the
// sizing below accounts for that, and also stays under the per-asset
// maxConcentrationPct cap (Fase 1.A4) for a single distinct asset, so this
// test isolates AGGREGATE exposure tracking specifically (each candidate
// here trades a different asset, so the concentration check never binds).
const FIXED_STRATEGY: StrategyDefinition = {
  id: "mock-always-long",
  kind: "TREND_FOLLOWING",
  name: "Mock Always Long",
  version: "1.0",
  defaultParams: {},
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"],
  // A 7.5% stop with 3% risk-per-trade (riskLevel 10) sizes each FULL
  // candidate at ~40% of equity (under the 45% per-asset concentration cap
  // at that level); at the guaranteed LOW_CONFIDENCE half-size that's a
  // clean ~20% actually added per opened position.
  defaultStopLossPct: 7.5,
  defaultTakeProfitPct: 15,
  defaultTrailingStopPct: null,
  costModel: { feeBps: 10, slippageBps: 5 },
  evaluate: () => ({ kind: "TREND_FOLLOWING", direction: "LONG", strength: 1, reason: "mock: always long" }),
};

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
let versionId: string;
const assetIds: string[] = [];
let accountId: string;

const NUM_ASSETS = 5; // one strategy version, five distinct assets — one candidate per asset, no cross-strategy/same-asset interaction to muddy the result

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `exposure-audit-${Date.now()}@example.com`, name: "Exposure Audit" } });
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

  for (let i = 0; i < NUM_ASSETS; i++) {
    const asset = await prisma.asset.create({ data: { symbol: `EXP${Date.now() % 100000}${i}`, name: `Exposure Audit Asset ${i}` } });
    assetIds.push(asset.id);
  }

  // riskLevel 10: riskPerTradePct 3%, maxExposurePct 90%, maxOpenPositions 8,
  // maxConcentrationPct 45% — generous enough on position count/concentration
  // that only the AGGREGATE exposure cap can bind in this scenario.
  const account = await prisma.paperAccount.create({
    data: { userId, name: "Exposure Audit Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 10 },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { accountId } });
  await prisma.positionStateChange.deleteMany({ where: { position: { accountId } } });
  await prisma.paperPosition.deleteMany({ where: { accountId } });
  await prisma.paperOrder.deleteMany({ where: { accountId } });
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

describe("AUDIT: runPaperTradingScan keeps openNotional live within a single scan (Fase 1.A3)", () => {
  it("never lets total open exposure exceed the account's maxExposurePct even when several candidates approve in the same cycle", async () => {
    await runPaperTradingScan(accountId);

    const openPositions = await prisma.paperPosition.findMany({ where: { accountId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
    const account = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });

    const totalNotional = openPositions.reduce((sum, p) => sum + p.entryPrice * p.remainingQuantity, 0);
    const exposurePct = (totalNotional / account.startingBalance) * 100;

    // With the bug, every candidate's exposure check sees openNotional stuck
    // at 0 (from before the scan started), so all 5 assets would open
    // (limited only by maxOpenPositions=8) at ~20% actual each — a real
    // total of ~100%, blowing far past the account's 90% maxExposurePct.
    // With the fix, only as many open as fit under that 90% cap (3, at
    // ~20% actual each = ~60% total) before the next candidate is
    // correctly BLOCKED by RISK_CHECK.
    expect(exposurePct).toBeLessThanOrEqual(90 + 1e-6);
    expect(openPositions.length).toBeGreaterThan(0);
    expect(openPositions.length).toBeLessThan(NUM_ASSETS);
  });
});
