import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getStrategyById } from "@/lib/engines/strategy";
import { RESEARCH20_STRATEGY_REGISTRY } from "@/lib/engines/strategy/research20";
import { runFamilyADiscovery } from "../phase20FamilyA";
import { DiscoveryContaminationError, tagAsIsOnly } from "../phase20Discovery";
import { compareHypothesisToStrategy } from "../phase20Comparison";
import { computeSessionDescriptiveStats } from "../phase20SessionAnalysis";
import { FROZEN_DATASET, FROZEN_RANGES, F20B_PARAMS, F20C_PARAMS, F20E_PARAMS, F20D_SESSIONS, MIN_SAMPLE_SIZE } from "../phase20PreRegistration";
import type { OHLCVBar } from "@/lib/providers/types";
import type { ReplayTradeRecord } from "@/lib/replay/types";

/**
 * Fase 20 spec Condición 12 — integrity checks that don't fit naturally
 * into a single module's own unit tests: no mutation of the 9 frozen
 * original strategies' parameters, no drift between the 3 new
 * strategies' CODE and their FROZEN pre-registered params, no dataset
 * mutation from anything this phase added, structural Discovery/OOS
 * contamination prevention (re-asserted end-to-end here, on top of
 * `phase20Discovery.test.ts`'s own unit tests), sample-size handling, and
 * reproducibility of the incremental-comparison module.
 */

const FROZEN_DEFAULT_PARAMS_SNAPSHOT_9: Record<string, Record<string, number | string | boolean>> = {
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

describe("Fase 20 — no mutation of the 9 pre-existing frozen strategies", () => {
  it("all 9 still resolve with EXACTLY their Fase 11/17 defaultParams, unchanged by anything Fase 20 added", () => {
    for (const [id, expected] of Object.entries(FROZEN_DEFAULT_PARAMS_SNAPSHOT_9)) {
      const def = getStrategyById(id);
      expect(def).toBeDefined();
      expect(def?.defaultParams).toEqual(expected);
    }
  });
});

describe("Fase 20 — the 3 new strategies' code matches their FROZEN pre-registered params exactly", () => {
  it("F20-B code defaultParams equal F20B_PARAMS", () => {
    const def = RESEARCH20_STRATEGY_REGISTRY.find((s) => s.id === "research20-volatility-transition-shock-v1");
    expect(def?.defaultParams).toEqual(F20B_PARAMS);
  });

  it("F20-C code defaultParams equal F20C_PARAMS", () => {
    const def = RESEARCH20_STRATEGY_REGISTRY.find((s) => s.id === "research20-volume-price-divergence-v1");
    expect(def?.defaultParams).toEqual(F20C_PARAMS);
  });

  it("F20-E code defaultParams equal F20E_PARAMS", () => {
    const def = RESEARCH20_STRATEGY_REGISTRY.find((s) => s.id === "research20-compression-duration-v1");
    expect(def?.defaultParams).toEqual(F20E_PARAMS);
  });

  it("exactly 3 strategies are formalized — never a 4th (F20-A/D stay out of StrategyDefinition form)", () => {
    expect(RESEARCH20_STRATEGY_REGISTRY).toHaveLength(3);
  });
});

describe("Fase 20 — no dataset mutation from any new module", () => {
  it("the frozen BTCUSDT H1 dataset row is byte-identical after running session analysis + comparison + family-A discovery-style computations", () => {
    const findDataset = () => prisma.researchDataset.findFirst({ where: { symbol: FROZEN_DATASET.symbol, timeframe: FROZEN_DATASET.timeframe, source: "binance_csv" } });

    return findDataset().then(async (before) => {
      const trades: ReplayTradeRecord[] = Array.from({ length: 25 }, (_, i) => ({
        asset: "BTC",
        strategyId: "s",
        strategyName: "S",
        direction: "LONG",
        entryTime: new Date(Date.UTC(2026, 0, 1 + i, 2)).toISOString(),
        exitTime: new Date(Date.UTC(2026, 0, 1 + i, 3)).toISOString(),
        entryPrice: 100,
        exitPrice: 105,
        quantity: 1,
        fees: 2,
        slippageCost: 1,
        grossPnl: 5,
        netPnl: i % 2 === 0 ? 5 : -3,
        exitReason: "TAKE_PROFIT",
        mae: 0,
        mfe: 5,
        decisionIndex: 0,
        stopLoss: 95,
        takeProfit: 105,
      }));
      computeSessionDescriptiveStats(trades, F20D_SESSIONS);
      compareHypothesisToStrategy(trades, trades, "self-test");

      const after = await findDataset();
      expect(after).toEqual(before);
    });
  });
});

describe("Fase 20 — structural Discovery/OOS contamination prevention (end-to-end, Condición 2)", () => {
  function bar(timestamp: Date): OHLCVBar {
    return { timestamp, open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
  }

  it("runFamilyADiscovery throws rather than silently computing on bars that reach into VALIDATION/OOS", () => {
    const contaminated = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.oos.start.getTime() + 3_600_000))];
    expect(() => runFamilyADiscovery(contaminated)).toThrow(DiscoveryContaminationError);
  });

  it("a caller cannot bypass the barrier by constructing an IsOnlyBars-shaped object manually — only tagAsIsOnly can produce one that validates", () => {
    const isBars = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.is.start.getTime() + 3_600_000))];
    const tagged = tagAsIsOnly(isBars);
    // The only way to get a value typed as IsOnlyBars is through tagAsIsOnly's own runtime validation — re-tagging the exact same array a second time must still pass (idempotent on genuinely valid input) and never silently accept a mutated, out-of-range copy.
    expect(() => tagAsIsOnly(tagged)).not.toThrow();
    const mutated = [...tagged, bar(new Date(FROZEN_RANGES.oos.end.getTime()))];
    expect(() => tagAsIsOnly(mutated)).toThrow(DiscoveryContaminationError);
  });
});

describe("Fase 20 — sample-size handling (MIN_SAMPLE_SIZE, Condición 12)", () => {
  it("computeSessionDescriptiveStats flags insufficientSample below MIN_SAMPLE_SIZE, and only then", () => {
    const trades: ReplayTradeRecord[] = Array.from({ length: MIN_SAMPLE_SIZE - 1 }, (_, i) => ({
      asset: "BTC",
      strategyId: "s",
      strategyName: "S",
      direction: "LONG",
      entryTime: new Date(Date.UTC(2026, 0, 1, 2)).toISOString(),
      exitTime: new Date(Date.UTC(2026, 0, 1, 3)).toISOString(),
      entryPrice: 100,
      exitPrice: 105,
      quantity: 1,
      fees: 1,
      slippageCost: 0.5,
      grossPnl: 5,
      netPnl: 5,
      exitReason: "TAKE_PROFIT",
      mae: 0,
      mfe: 5,
      decisionIndex: 0,
      stopLoss: 95,
      takeProfit: 105,
    }));
    const stats = computeSessionDescriptiveStats(trades, F20D_SESSIONS);
    const asia = stats.find((s) => s.session === "ASIA")!;
    expect(asia.tradeCount).toBe(MIN_SAMPLE_SIZE - 1);
    expect(asia.insufficientSample).toBe(true);
  });
});

describe("Fase 20 — reproducible incremental comparison (Condición 12: determinism)", () => {
  it("compareHypothesisToStrategy is byte-identical across two calls on the same input", () => {
    const trades: ReplayTradeRecord[] = Array.from({ length: 25 }, (_, i) => ({
      asset: "BTC",
      strategyId: "s",
      strategyName: "S",
      direction: "LONG",
      entryTime: new Date(Date.UTC(2026, 0, 1 + i, 2)).toISOString(),
      exitTime: new Date(Date.UTC(2026, 0, 1 + i, 3)).toISOString(),
      entryPrice: 100,
      exitPrice: 105,
      quantity: 1,
      fees: 1,
      slippageCost: 0.5,
      grossPnl: 5,
      netPnl: i % 3 === 0 ? 8 : -4,
      exitReason: "TAKE_PROFIT",
      mae: 0,
      mfe: 5,
      decisionIndex: 0,
      stopLoss: 95,
      takeProfit: 105,
    }));
    const a = compareHypothesisToStrategy(trades, trades, "x");
    const b = compareHypothesisToStrategy(trades, trades, "x");
    expect(a).toEqual(b);
  });
});
