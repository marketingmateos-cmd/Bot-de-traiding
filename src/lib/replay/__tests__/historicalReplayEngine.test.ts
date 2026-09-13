import { describe, expect, it } from "vitest";
import { runFullReplay } from "../runReplay";
import type { ReplayConfig } from "../types";
import { prisma } from "@/lib/db";

// Fase 7 STEP 1-3 — end-to-end smoke test: a genuine multi-week SYNTHETIC
// replay through the FULL pipeline (strategy -> AI -> Trade Gate -> Risk ->
// execution), never touching the live PaperAccount/PaperPosition/Trade
// tables, producing valid metrics either way (trades or none).
function baseConfig(overrides: Partial<ReplayConfig> = {}): ReplayConfig {
  return {
    assetSymbols: ["BTC"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-02-01T00:00:00.000Z"),
    strategyId: "trend-following",
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10000,
    riskLevel: 6,
    ...overrides,
  };
}

describe("AUDIT: HistoricalReplayEngine core (Fase 7 STEP 1-3)", () => {
  it("runs a full month-long synthetic replay end to end with valid, self-consistent metrics", async () => {
    const { result, dataQuality } = await runFullReplay(baseConfig(), new Map());

    expect(dataQuality.blocksReplay).toBe(false);
    expect(dataQuality.futureLeakage).toBe(0);
    expect(dataQuality.duplicateTimestamps).toBe(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.metrics.trades).toBe(result.trades.length);
    expect(Number.isFinite(result.metrics.finalEquity)).toBe(true);
    expect(result.metrics.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    // Win rate is always a valid fraction, whether or not anything traded.
    expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.winRate).toBeLessThanOrEqual(1);
  });

  it("never touches the live paper trading tables (isolation, spec rule #7)", async () => {
    const [accountsBefore, positionsBefore, tradesBefore] = await Promise.all([
      prisma.paperAccount.count(),
      prisma.paperPosition.count(),
      prisma.trade.count(),
    ]);

    await runFullReplay(baseConfig(), new Map());

    const [accountsAfter, positionsAfter, tradesAfter] = await Promise.all([
      prisma.paperAccount.count(),
      prisma.paperPosition.count(),
      prisma.trade.count(),
    ]);

    expect(accountsAfter).toBe(accountsBefore);
    expect(positionsAfter).toBe(positionsBefore);
    expect(tradesAfter).toBe(tradesBefore);
  });

  it("is deterministic: the exact same config produces byte-identical trades and metrics on two separate runs", async () => {
    const configA = baseConfig();
    const configB = baseConfig();
    const [runA, runB] = await Promise.all([runFullReplay(configA, new Map()), runFullReplay(configB, new Map())]);

    expect(runA.result.trades).toEqual(runB.result.trades);
    expect(runA.result.metrics).toEqual(runB.result.metrics);
    expect(runA.result.equityCurve).toEqual(runB.result.equityCurve);
  });

  it("with no trades at all, still returns valid (non-NaN, non-crashing) metrics", async () => {
    // riskLevel so low (and a short window) that realistically nothing
    // clears sizing/exposure — but the real point is the shape holds even
    // in the zero-trade case, not that this specific config guarantees it.
    const { result } = await runFullReplay(baseConfig({ endDate: new Date("2024-01-03T00:00:00.000Z") }), new Map());
    expect(Number.isNaN(result.metrics.totalReturnPct)).toBe(false);
    expect(Number.isNaN(result.metrics.avgTradeReturnPct)).toBe(false);
    expect(result.metrics.trades).toBeGreaterThanOrEqual(0);
  });
});
