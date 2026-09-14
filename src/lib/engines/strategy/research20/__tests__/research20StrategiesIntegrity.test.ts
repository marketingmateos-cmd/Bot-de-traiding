import { describe, expect, it } from "vitest";
import { runFullReplay } from "@/lib/replay/runReplay";
import type { ReplayConfig } from "@/lib/replay/types";
import { RESEARCH20_STRATEGY_REGISTRY } from "../index";

/**
 * Fase 20 spec Condición 12 — same structural anti-lookahead invariant
 * already established for the Fase 17 research strategies
 * (`research/__tests__/researchStrategiesIntegrity.test.ts`), applied to
 * the 3 Fase 20 families formalized as `StrategyDefinition` (F20-B/C/E).
 * Runs each through the REAL, unmodified `HistoricalReplayEngine` over a
 * full SYNTHETIC replay and checks that every trade's `entryTime` exactly
 * matches its own `decisionIndex`'s decision timestamp.
 */
function baseConfig(strategyId: string): ReplayConfig {
  return {
    assetSymbols: ["BTC"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-07-01T00:00:00.000Z"),
    strategyId,
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10_000,
    riskLevel: 6,
  };
}

describe("Fase 20 research strategies (B/C/E) — structural integrity over a real SYNTHETIC replay", () => {
  for (const strategyDef of RESEARCH20_STRATEGY_REGISTRY) {
    describe(strategyDef.id, () => {
      it("the run always completes (never FAILED) through the unmodified HistoricalReplayEngine", async () => {
        const { result, dataQuality } = await runFullReplay(baseConfig(strategyDef.id), new Map());
        expect(dataQuality.blocksReplay).toBe(false);
        expect(Number.isFinite(result.metrics.trades)).toBe(true);
        expect(result.metrics.trades).toBe(result.trades.length);
      });

      it("every trade's entryTime exactly matches its own decisionIndex's decision timestamp (no lookahead)", async () => {
        const { result } = await runFullReplay(baseConfig(strategyDef.id), new Map());
        for (const trade of result.trades) {
          const decision = result.decisions[trade.decisionIndex];
          expect(decision).toBeDefined();
          expect(trade.entryTime).toBe(decision.timestamp);
        }
      });

      it("decision timestamps are monotonically non-decreasing", async () => {
        const { result } = await runFullReplay(baseConfig(strategyDef.id), new Map());
        for (let i = 1; i < result.decisions.length; i++) {
          expect(Date.parse(result.decisions[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(result.decisions[i - 1].timestamp));
        }
      });

      it("every trade has entryTime <= exitTime, finite netPnl/fees, and fees >= 0", async () => {
        const { result } = await runFullReplay(baseConfig(strategyDef.id), new Map());
        for (const trade of result.trades) {
          expect(Date.parse(trade.entryTime)).toBeLessThanOrEqual(Date.parse(trade.exitTime));
          expect(Number.isFinite(trade.netPnl)).toBe(true);
          expect(Number.isFinite(trade.grossPnl)).toBe(true);
          expect(trade.fees).toBeGreaterThanOrEqual(0);
        }
      });

      it("the exact same config produces byte-identical trades and metrics across two separate runs (determinism)", async () => {
        const runA = await runFullReplay(baseConfig(strategyDef.id), new Map());
        const runB = await runFullReplay(baseConfig(strategyDef.id), new Map());
        expect(runB.result.trades).toEqual(runA.result.trades);
        expect(runB.result.metrics).toEqual(runA.result.metrics);
      });
    });
  }
});
