import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import type { StrategyDefinition } from "@/lib/engines/strategy/types";
import type { AIAnalystOutput, AICriticOutput, OHLCVBar } from "@/lib/providers/types";

// Fase 5 — regression/feature test for wiring the previously-dead
// `correlation()` function (riskEngine.ts) into a real check: several
// DIFFERENT assets that move together can recreate the exact concentrated
// bet the same-asset concentration check (Fase 1.A4) alone can't see, since
// each individually looks like a different, unrelated position.
//
// This constructs two assets ("CORRA"/"CORRB") whose bars are IDENTICAL —
// perfect correlation — and a third ("UNCORR") whose bars move in the exact
// opposite direction every bar — perfect ANTI-correlation, which the
// absolute-value threshold check should also catch. One strategy version
// signals LONG on all three within a single scan; CORRA opens first, and
// CORRB/UNCORR are evaluated afterward in the SAME scan, by which point
// CORRA is already open — so this exercises the in-scan `openPositions`
// update (Fase 1.A3's mechanism) feeding the correlation check too.

function makeBars(closes: number[]): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 60 * 60_000;
  return closes.map((close, i) => ({
    timestamp: new Date(now - (closes.length - i) * stepMs),
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 1000,
  }));
}

// A distinctive random-looking but DETERMINISTIC walk, reused as the base
// pattern for CORRA/CORRB (identical) and inverted for UNCORR.
const BASE_STEPS = [0.01, -0.02, 0.015, 0.03, -0.01, 0.02, -0.025, 0.01, 0.005, -0.015, 0.02, -0.01, 0.03, -0.02, 0.01];
function walkFrom(start: number, steps: number[]): number[] {
  const closes = [start];
  for (const step of steps) closes.push(closes[closes.length - 1] * (1 + step));
  return closes;
}
const CORRELATED_CLOSES_A = walkFrom(100, BASE_STEPS);
const CORRELATED_CLOSES_B = walkFrom(50, BASE_STEPS); // same relative steps, different scale — correlation is scale-invariant
const UNCORRELATED_CLOSES = walkFrom(200, BASE_STEPS.map((s) => -s)); // exact opposite moves every bar

const BARS_BY_SYMBOL: Record<string, OHLCVBar[]> = {};

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

// 7.5% stop (riskLevel 10: 3% risk / 7.5% stop = 40% of equity full-size,
// ~20% actual at the guaranteed LOW_CONFIDENCE half-size fresh strategies
// always get) sizes each position so that ONE already-open position's
// actual notional (20%) plus a second candidate's full prospective notional
// (40%) clears the 45% maxConcentrationPct cap when combined via
// correlation — but a single position alone (20% or 40%) stays comfortably
// under both maxExposurePct(90%) and maxConcentrationPct(45%), so only the
// CORRELATION check, never a coincidental same-asset/aggregate breach,
// explains any block in this test.
const FIXED_STRATEGY: StrategyDefinition = {
  id: "mock-always-long",
  kind: "TREND_FOLLOWING",
  name: "Mock Always Long",
  version: "1.0",
  defaultParams: {},
  timeframe: "H1",
  recommendedRegimes: ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"],
  defaultStopLossPct: 7.5,
  defaultTakeProfitPct: 15,
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
  getSymbolAnalysis: async (symbol: string) => {
    const bars = BARS_BY_SYMBOL[symbol] ?? makeBars(walkFrom(100, BASE_STEPS));
    const lastClose = bars[bars.length - 1].close;
    return {
      symbol,
      timeframe: "H1",
      bars,
      isDemo: true,
      source: "mock",
      dataQuality: { score: 90, issues: [], blocksTrading: false },
      features: { close: lastClose, sma20: lastClose, sma50: lastClose, ema20: lastClose, rsi14: 55, macdHistogram: 0, atr14: 1, bbUpper: lastClose * 1.05, bbLower: lastClose * 0.95, volatility20: 0.01, volumeZScore20: 0, trend: 0.5, momentum: 0.3 },
      regime: { regime: "BULL", confidence: 0.8, details: { trendSlopePct: 1, volatilityPercentile: 40, rangeWidthPct: 2 } },
      news: { score: 60, topStories: [], clusterCount: 0, totalArticles: 0 },
      sentiment: { current: 0.2, trend: 0.1, acceleration: 0, divergence: false, divergenceMagnitude: 0, score: 60 },
      onChain: [{ symbol, metric: "whale_activity", timestamp: new Date(), value: 1, available: true }],
      marketIntelligence: { score: 75 },
      priceChangePct: 2,
      latestPrice: lastClose,
    };
  },
}));

const { runPaperTradingScan } = await import("@/lib/paperTradingEngine");

let userId: string;
let strategyId: string;
let versionId: string;
const assetIds: Record<string, string> = {};
let accountId: string;

beforeAll(async () => {
  await prisma.strategy.updateMany({ data: { isActive: false } });
  await prisma.asset.updateMany({ data: { isActive: false } });

  const user = await prisma.user.create({ data: { email: `correlation-audit-${Date.now()}@example.com`, name: "Correlation Audit" } });
  userId = user.id;

  const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Mock Strategy" } });
  strategyId = strategy.id;

  const suffix = Date.now() % 100000;
  const symbols: [string, string][] = [
    ["CORRA", "Correlated Asset A"],
    ["CORRB", "Correlated Asset B"],
    ["UNCORR", "Anti-Correlated Asset"],
  ];
  for (const [prefix, name] of symbols) {
    const symbol = `${prefix}${suffix}`;
    const asset = await prisma.asset.create({ data: { symbol, name } });
    assetIds[prefix] = asset.id;
    if (prefix === "CORRA") BARS_BY_SYMBOL[symbol] = makeBars(CORRELATED_CLOSES_A);
    if (prefix === "CORRB") BARS_BY_SYMBOL[symbol] = makeBars(CORRELATED_CLOSES_B);
    if (prefix === "UNCORR") BARS_BY_SYMBOL[symbol] = makeBars(UNCORRELATED_CLOSES);
  }

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

  // riskLevel 10: maxExposurePct 90%, maxConcentrationPct 45%, maxOpenPositions 8
  // — generous enough that only CORRELATION explains any block here.
  const account = await prisma.paperAccount.create({
    data: { userId, name: "Correlation Audit Account", startingBalance: 10000, cashBalance: 10000, riskLevel: 10 },
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
  await prisma.aIAnalysis.deleteMany({ where: { assetId: { in: Object.values(assetIds) } } });
  await prisma.strategyVersion.delete({ where: { id: versionId } });
  await prisma.strategy.delete({ where: { id: strategyId } });
  for (const assetId of Object.values(assetIds)) {
    await prisma.asset.delete({ where: { id: assetId } });
  }
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("AUDIT: correlation is a real risk control across different assets (Fase 5)", () => {
  it("opens only ONE of three mutually highly-correlated assets, blocking the other two specifically for CORRELATION", async () => {
    // All three are mutually |correlation| ~= 1: CORRA/CORRB move in
    // identical lockstep (correlation ~1), and UNCORR moves in the exact
    // opposite direction every single bar (correlation ~-1, so |corr| ~1
    // against both). Whichever the scan evaluates first should open
    // normally; the other two, evaluated afterward in the SAME scan, must
    // each be blocked once combined with that first one's now-open notional
    // — the actual order asset rows come back in isn't something this test
    // should need to assume.
    const results = await runPaperTradingScan(accountId);

    const corrAResult = results.find((r) => r.symbol.startsWith("CORRA"));
    const corrBResult = results.find((r) => r.symbol.startsWith("CORRB"));
    const uncorrResult = results.find((r) => r.symbol.startsWith("UNCORR"));
    expect(corrAResult).toBeDefined();
    expect(corrBResult).toBeDefined();
    expect(uncorrResult).toBeDefined();

    const openPositions = await prisma.paperPosition.findMany({ where: { accountId }, include: { asset: true } });
    expect(openPositions.length).toBe(1); // exactly one of the three actually opened

    const blockedResults = [corrAResult, corrBResult, uncorrResult].filter((r) => r!.verdict === "BLOCKED");
    expect(blockedResults.length).toBe(2);
    for (const r of blockedResults) {
      expect(r!.blockedBy).toBe("RISK_CHECK");
    }

    const riskEvents = await prisma.riskEvent.findMany({ where: { accountId, kind: "CORRELATION" } });
    expect(riskEvents.length).toBeGreaterThan(0);
  });
});
