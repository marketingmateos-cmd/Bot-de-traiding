import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getStrategyById } from "@/lib/engines/strategy";
import { runBootstrapMonteCarlo } from "../phase19MonteCarlo";
import { FROZEN_STRATEGY_IDS, FROZEN_EVALUATION_PROFILE, FROZEN_DATASET } from "../phase19PreRegistration";
import type { ReplayTradeRecord } from "@/lib/replay/types";

/**
 * Fase 19 spec section 28/29 — integrity checks that don't fit naturally
 * into `phase19MonteCarlo.test.ts`'s pure-function tests: that this phase
 * never mutated any of the 9 frozen strategies' parameters, that OOS
 * analysis structurally cannot see IS/VALIDATION trades, and that the
 * dataset row itself is never written to by anything in this phase.
 */

function trade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "s1",
    strategyName: "S1",
    direction: "LONG",
    entryTime: "2026-01-01T00:00:00.000Z",
    exitTime: "2026-01-01T01:00:00.000Z",
    entryPrice: 100,
    exitPrice: 105,
    quantity: 1,
    fees: 2,
    slippageCost: 1,
    grossPnl: 5,
    netPnl: 5,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 5,
    decisionIndex: 0,
    stopLoss: 95,
    takeProfit: 105,
    ...overrides,
  };
}

const FROZEN_DEFAULT_PARAMS_SNAPSHOT: Record<string, Record<string, number | string | boolean>> = {
  "breakout-baseline-v1": { lookback: 20, volatilityPeriod: 14, atrMultiplier: 1.5, rrr: 1.5 },
  "momentum-baseline-v1": { lookback: 10, momentumThreshold: 0.02, volatilityPeriod: 14, rrr: 1.5 },
  "mean-reversion-baseline-v1": { meanPeriod: 20, deviationThreshold: 2, volatilityPeriod: 14, rrr: 1.5 },
  "trend-following-baseline-v1": { fastPeriod: 20, slowPeriod: 50, volatilityPeriod: 14, rrr: 2 },
  "research-volatility-squeeze-v1": { atrPeriod: 14, squeezeLookback: 40, squeezePercentile: 20, rangeLookback: 10, expansionMultiplier: 1.3, rrr: 1.5 },
  "research-volume-confirmation-v1": { priceLookback: 5, priceThreshold: 0.01, volumeZPeriod: 20, volumeZThreshold: 1.5, volatilityPeriod: 14, rrr: 1.5 },
  "research-trend-pullback-v1": { fastPeriod: 20, slowPeriod: 50, pullbackBars: 3, volatilityPeriod: 14, rrr: 1.5 },
  "research-breakout-confirmation-v1": { lookback: 20, volatilityPeriod: 14, atrMultiplier: 1.5, rrr: 1.5, closePositionThreshold: 0.7, volumeZThreshold: 1 },
  "research-momentum-reversal-v1": { rsiPeriod: 14, rsiOverbought: 75, rsiOversold: 25, volatilityPeriod: 14, rrr: 1.5 },
};

describe("Fase 19 — no strategy parameter mutation (spec sections 29/31)", () => {
  it("all 9 frozen strategies still resolve with EXACTLY their Fase 11/17 defaultParams, unchanged", () => {
    expect(FROZEN_STRATEGY_IDS).toHaveLength(9);
    for (const id of FROZEN_STRATEGY_IDS) {
      const def = getStrategyById(id);
      expect(def).toBeDefined();
      expect(def?.defaultParams).toEqual(FROZEN_DEFAULT_PARAMS_SNAPSHOT[id]);
    }
  });
});

describe("Fase 19 — no dataset mutation (spec sections 29/31)", () => {
  it("the frozen BTCUSDT H1 dataset row is byte-identical after running the Monte Carlo engine on sample trades", async () => {
    const before = await prisma.researchDataset.findFirst({ where: { symbol: FROZEN_DATASET.symbol, timeframe: FROZEN_DATASET.timeframe, source: "binance_csv" } });

    const sampleTrades = Array.from({ length: 30 }, (_, i) => trade({ netPnl: i % 2 === 0 ? 10 : -5, exitTime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
    runBootstrapMonteCarlo(sampleTrades, {
      iterations: 500,
      seed: 19,
      initialEquity: 20000,
      evaluationProfile: FROZEN_EVALUATION_PROFILE,
      ruinThresholdPct: 50,
      returnThresholdsPct: [0, 3, 5],
      drawdownThresholdsPct: [5, 10, 15, 20],
    });

    const after = await prisma.researchDataset.findFirst({ where: { symbol: FROZEN_DATASET.symbol, timeframe: FROZEN_DATASET.timeframe, source: "binance_csv" } });
    expect(after).toEqual(before);
  });
});

describe("Fase 19 — OOS isolation (spec sections 11/12)", () => {
  it("analyzing two different trade sets (standing in for IS vs OOS) never lets one influence the other's simulated distribution", () => {
    const isTrades = Array.from({ length: 50 }, () => trade({ netPnl: 100 })); // all winners
    const oosTrades = Array.from({ length: 25 }, () => trade({ netPnl: -100 })); // all losers

    const options = {
      iterations: 1000,
      seed: 19,
      initialEquity: 20000,
      evaluationProfile: FROZEN_EVALUATION_PROFILE,
      ruinThresholdPct: 50,
      returnThresholdsPct: [0, 3, 5],
      drawdownThresholdsPct: [5, 10, 15, 20],
    };

    const isResult = runBootstrapMonteCarlo(isTrades, options);
    const oosResult = runBootstrapMonteCarlo(oosTrades, options);

    // If OOS were ever contaminated by IS's all-winning trades, its return distribution couldn't be uniformly negative.
    expect(isResult.finalReturnPct.p5).toBeGreaterThan(0);
    expect(oosResult.finalReturnPct.p95).toBeLessThan(0);
  });
});
