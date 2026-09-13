import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import { calculatePositionSize, resolveRiskLimitsForLevel } from "@/lib/engines/riskEngine";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput, OHLCVBar } from "@/lib/providers/types";

// Fase 6 — Daily Profit Protection, PROFIT_PROTECTION state: unlike
// HARD_DAILY_STOP (see paperTradingEngine.hardDailyStop.test.ts), this state
// does not block everything outright — it blocks every candidate EXCEPT one
// that clears the quantitative "exceptional opportunity" bar (see
// dailyProfitProtection.ts's checkExceptionalOpportunity), and even then
// only at a reduced size. This test proves both halves end-to-end through
// runPaperTradingScan: (a) a brand-new strategy version with zero trade
// history (LOW evidence) is blocked by DAILY_PROFIT_PROTECTION no matter how
// confident the AI mock is, and (b) a strategy version with a genuine,
// seeded 35-trade track record (MEDIUM evidence) clearing every criterion IS
// allowed through, but sized at exceptionalSizeMultiplier (0.5), never full
// size — protecting today's gains never fully disappears even for a verified
// exception.

const FIXED_ANALYST_OUTPUT: AIAnalystOutput = {
  signal: "LONG",
  confidence: 0.95,
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

function makeBars(): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 60 * 60_000;
  return Array.from({ length: 20 }, (_, i) => ({
    timestamp: new Date(now - (20 - i) * stepMs),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
}

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
    bars: makeBars(),
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
let versionFreshId: string;
let versionSeasonedId: string;
let assetFreshId: string;
let assetSeasonedId: string;
let assetFreshSymbol: string;
let assetSeasonedSymbol: string;
let accountId: string;
const seededTradeIds: string[] = [];
const seededPositionIds: string[] = [];

beforeAll(async () => {
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `profit-protection-audit-${Date.now()}@example.com`, name: "Profit Protection Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

  const suffix = Date.now() % 100000;
  assetFreshSymbol = `PPFRESH${suffix}`;
  assetSeasonedSymbol = `PPSEASON${suffix}`;
  const assetFresh = await prisma.asset.create({ data: { symbol: assetFreshSymbol, name: "Fresh (no history) asset" } });
  assetFreshId = assetFresh.id;
  const assetSeasoned = await prisma.asset.create({ data: { symbol: assetSeasonedSymbol, name: "Seasoned (real history) asset" } });
  assetSeasonedId = assetSeasoned.id;

  const allRegimes = toJson(["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"]);
  const makeVersion = (version: string, allowedSymbol: string) =>
    prisma.strategyVersion.create({
      data: {
        strategyId,
        version,
        parameters: toJson({}),
        timeframe: "H1",
        allowedMarkets: toJson([allowedSymbol]),
        recommendedRegimes: allRegimes,
        entryRules: toJson({}),
        exitRules: toJson({}),
        filters: toJson({}),
        costModel: toJson({ feeBps: 10, slippageBps: 5 }),
      },
    });
  const versionFresh = await makeVersion("1.0-fresh", assetFreshSymbol);
  versionFreshId = versionFresh.id;
  const versionSeasoned = await makeVersion("1.0-seasoned", assetSeasonedSymbol);
  versionSeasonedId = versionSeasoned.id;

  // riskLevel 3 (CONSERVATIVE): riskPerTradePct 0.5%, maxExposurePct 30%,
  // maxConcentrationPct 15% — comfortably clears a single ~10% position.
  const account = await prisma.paperAccount.create({
    data: { userId, name: "Profit Protection Audit Account", startingBalance: 10000, cashBalance: 10800, riskLevel: 3 },
  });
  accountId = account.id;

  // Seed a genuine, verifiable 35-trade track record for the SEASONED
  // strategy version — 24 wins (+2% each) / 11 losses (-1% each, spread out
  // rather than clustered so drawdown stays small), all dated BEFORE today
  // (UTC) so they count toward start-of-day equity but never toward
  // "today's" trade count. 35 trades clears MIN_TRADES_MEDIUM (30) with
  // winRate ~69% (<70%, avoids the "lucky streak" warning) and a strong
  // Sharpe — exactly one warning (no out-of-sample results yet), which is
  // <= the 2-warning ceiling for MEDIUM evidence (see luckVsEdge.ts).
  const todayStartUTC = new Date();
  todayStartUTC.setUTCHours(0, 0, 0, 0);
  const LOSS_INDICES = new Set([2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32]);
  let realizedHistoryPnl = 0;
  for (let i = 0; i < 35; i++) {
    const isLoss = LOSS_INDICES.has(i);
    const netPnl = isLoss ? -10 : 20;
    const exitPrice = isLoss ? 99 : 102;
    realizedHistoryPnl += netPnl;
    const closedAt = new Date(todayStartUTC.getTime() - (35 - i) * 3600_000);
    const position = await prisma.paperPosition.create({
      data: {
        accountId,
        assetId: assetSeasonedId,
        strategyVersionId: versionSeasonedId,
        direction: "LONG",
        status: "CLOSED",
        entryPrice: 100,
        quantity: 10,
        remainingQuantity: 0,
        openedAt: new Date(closedAt.getTime() - 3600_000),
        closedAt,
        snapshot: toJson({}),
      },
    });
    seededPositionIds.push(position.id);
    const trade = await prisma.trade.create({
      data: {
        accountId,
        positionId: position.id,
        assetId: assetSeasonedId,
        strategyVersionId: versionSeasonedId,
        direction: "LONG",
        entryPrice: 100,
        exitPrice,
        quantity: 10,
        fees: 0,
        slippageCost: 0,
        grossPnl: netPnl,
        netPnl,
        mae: 0.5,
        mfe: 1,
        durationSeconds: 3600,
        exitReason: isLoss ? "STOP_LOSS" : "TAKE_PROFIT",
        openedAt: new Date(closedAt.getTime() - 3600_000),
        closedAt,
      },
    });
    seededTradeIds.push(trade.id);
  }

  // Real numbers, not an AI opinion: start-of-day equity is starting
  // balance PLUS the 35 seeded trades' real net P&L (all dated yesterday);
  // cashBalance (today's equity, no trades closed yet today) is set so the
  // resulting daily P&L clears the default 3% PROFIT_PROTECTION trigger.
  const startOfDayEquity = 10000 + realizedHistoryPnl;
  const dailyPnlPct = ((10800 - startOfDayEquity) / startOfDayEquity) * 100;
  expect(dailyPnlPct).toBeGreaterThanOrEqual(3);
  expect(dailyPnlPct).toBeLessThan(50); // sanity: nowhere near a runaway number

  await prisma.profitProtectionConfig.upsert({
    where: { id: "main" },
    update: { hardStopLossPct: -5, profitProtectionTriggerPct: 3, exceptionalMinConfidence: 0.85, exceptionalMinEvidenceLevel: "MEDIUM", exceptionalSizeMultiplier: 0.5, lastState: "NORMAL" },
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
  await prisma.aIAnalysis.deleteMany({ where: { assetId: { in: [assetFreshId, assetSeasonedId] } } });
  await prisma.strategyVersion.delete({ where: { id: versionFreshId } });
  await prisma.strategyVersion.delete({ where: { id: versionSeasonedId } });
  await prisma.strategy.delete({ where: { id: strategyId } });
  await prisma.asset.delete({ where: { id: assetFreshId } });
  await prisma.asset.delete({ where: { id: assetSeasonedId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: PROFIT_PROTECTION only lets a quantitatively-verified exception through, at reduced size (Fase 6)", () => {
  // A single scan evaluates BOTH candidates at once; a second scan would
  // silently skip the seasoned asset once its position is open (the
  // existing-position guard), so every assertion below shares the one scan.
  let results: Awaited<ReturnType<typeof runPaperTradingScan>>;

  it("runs the scan once", async () => {
    results = await runPaperTradingScan(accountId);
    expect(results.length).toBeGreaterThan(0);
  });

  it("blocks the fresh (zero-history) candidate outright via DAILY_PROFIT_PROTECTION despite a maximally-confident AI mock", async () => {
    const freshResult = results.find((r) => r.symbol === assetFreshSymbol);
    expect(freshResult).toBeDefined();
    expect(freshResult!.verdict).toBe("BLOCKED");
    expect(freshResult!.blockedBy).toBe("DAILY_PROFIT_PROTECTION");

    const freshPosition = await prisma.paperPosition.findFirst({ where: { accountId, assetId: assetFreshId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
    expect(freshPosition).toBeNull();
  });

  it("allows the seasoned (real, verified track record) candidate through, but only at the configured reduced size", async () => {
    const seasonedResult = results.find((r) => r.symbol === assetSeasonedSymbol);
    expect(seasonedResult).toBeDefined();
    expect(seasonedResult!.verdict).toBe("APPROVED");
    expect(seasonedResult!.blockedBy).toBeNull();

    const seasonedPosition = await prisma.paperPosition.findFirst({ where: { accountId, assetId: assetSeasonedId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
    expect(seasonedPosition).not.toBeNull();

    const riskLimits = resolveRiskLimitsForLevel(3);
    const fullSizing = calculatePositionSize({ equity: 10800, entryPrice: 100, stopLossPrice: 95, riskPerTradePct: riskLimits.riskPerTradePct });
    const expectedExceptionalQuantity = fullSizing.quantity * 0.5;

    // Paper Execution (paperExecution.ts's simulateFill) randomly partially
    // fills ~8% of orders at 50-90% of the requested quantity, seeded by the
    // order's own freshly-generated id — so the exact filled quantity isn't
    // deterministic across runs. What Daily Profit Protection controls is
    // the REQUESTED size (never more than expectedExceptionalQuantity, the
    // half-size exceptional-opportunity amount); the fill layer can only
    // ever shrink that further, never grow it past full size.
    expect(seasonedPosition!.quantity).toBeGreaterThan(0);
    expect(seasonedPosition!.quantity).toBeLessThanOrEqual(expectedExceptionalQuantity + 1e-9);
    expect(seasonedPosition!.quantity).toBeGreaterThanOrEqual(expectedExceptionalQuantity * 0.5 - 1e-9);
    expect(seasonedPosition!.quantity).toBeLessThan(fullSizing.quantity);
  });

  it("cleans up: config reflects the account is (still) in PROFIT_PROTECTION, not HARD_DAILY_STOP", async () => {
    const config = await prisma.profitProtectionConfig.findUniqueOrThrow({ where: { id: "main" } });
    expect(config.lastState).toBe("PROFIT_PROTECTION");
  });
});
