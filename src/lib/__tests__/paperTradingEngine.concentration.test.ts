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

describe("AUDIT: runPaperTradingScan caps per-asset concentration across different strategies (Fase 1.A4 + Risk Level coherence fix)", () => {
  it("never lets several different strategy versions combine to exceed maxConcentrationPct on the same single asset — clamping each down rather than blocking outright once the cap is close", async () => {
    await runPaperTradingScan(accountId);

    const openPositions = await prisma.paperPosition.findMany({
      where: { accountId, assetId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } },
      orderBy: { openedAt: "asc" },
    });
    const account = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });

    const assetNotional = openPositions.reduce((sum, p) => sum + p.entryPrice * p.remainingQuantity, 0);
    const concentrationPct = (assetNotional / account.startingBalance) * 100;

    // With the OLD all-or-nothing gate, every one of the 6 different
    // strategy versions passed its own exposure/concentration check
    // independently (each looked fine in isolation), so all 6 would open
    // on this one asset at ~10% actual each — a real concentration of
    // ~60%, blowing past the 45% cap. With the Risk Level coherence fix,
    // checkExposureLimits CLAMPS each candidate's size down to whatever
    // concentration headroom remains instead of blocking it outright — so
    // every candidate still opens (no operation is forced OR needlessly
    // rejected when a smaller, honest size fits), but strictly smaller as
    // the shared cap fills up, and the combined bet never exceeds it.
    expect(concentrationPct).toBeLessThanOrEqual(45 + 1e-6);
    expect(openPositions.length).toBe(NUM_VERSIONS);

    // Each candidate's own UNCLAMPED half-size (LOW_CONFIDENCE, fresh
    // strategy) is equity(10000) * riskPerTradePct(3%) / stopLossPct(15%)
    // * 0.5 = 1000 before the fill's own few-bps slippage, — no single
    // position's REQUESTED size may ever exceed that (the Risk Engine only
    // ever reduces a request, never grants more; the fill price itself can
    // still land a hair past 1000 once realistic slippage is applied on
    // top). Since 6 * 1000 = 6000 (60%) would blow past the 45% cap, the
    // combined total actually opened must land strictly below that naive
    // sum — proof that clamping, not luck, is what kept concentration in
    // bounds. (The exact evaluation order across strategy versions within
    // one scan isn't guaranteed, so this checks the aggregate outcome, not
    // a specific per-position ordering.)
    const notionals = openPositions.map((p) => p.entryPrice * p.remainingQuantity);
    const UNCLAMPED_HALF_SIZE = 1000;
    const SLIPPAGE_TOLERANCE = 1.01; // a few bps of adverse fill slippage on top of the requested notional
    for (const notional of notionals) {
      expect(notional).toBeLessThanOrEqual(UNCLAMPED_HALF_SIZE * SLIPPAGE_TOLERANCE);
    }
    const totalNotional = notionals.reduce((s, n) => s + n, 0);
    expect(totalNotional).toBeLessThan(NUM_VERSIONS * UNCLAMPED_HALF_SIZE);
    expect(notionals.some((n) => n < UNCLAMPED_HALF_SIZE * 0.999999)).toBe(true);
  });

  it("records an INFO-severity RiskEvent (not a WARN block) for every candidate whose size was clamped, not rejected (Fase 2 — RiskEvent was previously a dead table)", async () => {
    const riskEvents = await prisma.riskEvent.findMany({ where: { accountId } });
    expect(riskEvents.length).toBeGreaterThan(0);
    expect(riskEvents.every((e) => e.kind === "CONCENTRATION")).toBe(true);
    expect(riskEvents.every((e) => e.severity === "INFO")).toBe(true);
    expect(riskEvents.every((e) => e.message.toLowerCase().includes("concentración") || e.message.toLowerCase().includes("reducido"))).toBe(true);
  });
});

describe("AUDIT: a genuinely saturated concentration cap still rejects cleanly, never forcing a trade (Risk Level coherence fix)", () => {
  let saturatedAccountId: string;
  let saturatedAssetId: string;
  let seedVersionId: string;
  let candidateVersionId: string;

  beforeAll(async () => {
    await prisma.strategy.updateMany({ data: { isActive: false } });
    await prisma.asset.updateMany({ data: { isActive: false } });
    // Reactivate the shared `strategy` row (created by the describe block
    // above, reused here for its new versions) — the blanket deactivate
    // just above would otherwise leave it inactive and the scan would
    // never pick up either version created below.
    await prisma.strategy.update({ where: { id: strategyId }, data: { isActive: true } });

    const asset = await prisma.asset.create({ data: { symbol: `SATC${Date.now() % 100000}`, name: "Saturated Concentration Asset" } });
    saturatedAssetId = asset.id;

    const allRegimes = toJson(["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"]);
    const makeVersion = (version: string) =>
      prisma.strategyVersion.create({
        data: {
          strategyId,
          version,
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
    // Two DIFFERENT strategy versions on the SAME asset: the pre-seeded
    // position uses one, the scan's live candidate uses the other — so the
    // per-(asset, strategyVersion) existingPosition dedup never skips
    // evaluating the candidate, and it's genuinely the asset-level
    // concentration cap (summed across BOTH versions) doing the rejecting.
    seedVersionId = (await makeVersion("saturated-seed-1.0")).id;
    candidateVersionId = (await makeVersion("saturated-candidate-1.0")).id;

    const account = await prisma.paperAccount.create({
      data: { userId, name: "Saturated Concentration Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 10 },
    });
    saturatedAccountId = account.id;

    // Pre-seed an existing open position that ALREADY sits exactly at the
    // 45% maxConcentrationPct cap for this account/asset — zero headroom
    // left, on purpose, so the next candidate has nothing to clamp INTO.
    await prisma.paperPosition.create({
      data: {
        accountId: saturatedAccountId,
        assetId: saturatedAssetId,
        strategyVersionId: seedVersionId,
        direction: "LONG",
        status: "OPEN",
        entryPrice: 100,
        quantity: 45,
        remainingQuantity: 45, // 45 * 100 = 4500 = exactly 45% of 10000
        openedAt: new Date(),
        snapshot: toJson({}),
      },
    });
  });

  afterAll(async () => {
    await prisma.trade.deleteMany({ where: { accountId: saturatedAccountId } });
    await prisma.positionStateChange.deleteMany({ where: { position: { accountId: saturatedAccountId } } });
    await prisma.paperPosition.deleteMany({ where: { accountId: saturatedAccountId } });
    await prisma.paperOrder.deleteMany({ where: { accountId: saturatedAccountId } });
    await prisma.riskEvent.deleteMany({ where: { accountId: saturatedAccountId } });
    await prisma.paperAccount.delete({ where: { id: saturatedAccountId } });
    await prisma.strategyVersion.delete({ where: { id: seedVersionId } });
    await prisma.strategyVersion.delete({ where: { id: candidateVersionId } });
    await prisma.asset.delete({ where: { id: saturatedAssetId } });
  });

  it("rejects the new candidate cleanly (zero quantity) instead of forcing a trade when concentration headroom is already fully saturated", async () => {
    await runPaperTradingScan(saturatedAccountId);

    const openPositions = await prisma.paperPosition.findMany({
      where: { accountId: saturatedAccountId, assetId: saturatedAssetId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } },
    });
    // Still exactly the one pre-seeded position — nothing new was forced open.
    expect(openPositions).toHaveLength(1);
    expect(openPositions[0].quantity).toBe(45);

    const riskEvents = await prisma.riskEvent.findMany({ where: { accountId: saturatedAccountId, kind: "CONCENTRATION" } });
    expect(riskEvents.length).toBeGreaterThan(0);
    expect(riskEvents.every((e) => e.severity === "WARN")).toBe(true);
  });
});
