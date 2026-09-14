import { describe, expect, it } from "vitest";
import { runFullReplay } from "@/lib/replay/runReplay";
import type { ReplayConfig } from "@/lib/replay/types";
import { RESEARCH_STRATEGY_REGISTRY } from "../index";

/**
 * Fase 17 spec section 8 — "Añadir tests específicos de causalidad.
 * Idealmente implementar al menos un test estructural o equivalente al
 * audit de Fase 15." This runs each of the 5 new research strategies
 * through the REAL, unmodified `HistoricalReplayEngine` over a full
 * SYNTHETIC replay (same pattern as
 * `executionIntegrityAudit.test.ts`'s own "SIGNAL TIMING & WHOLE-RUN
 * INVARIANTS" section) and checks the same structural anti-lookahead
 * invariant that audit already established engine-wide: every trade's
 * `entryTime` exactly matches its own `decisionIndex`'s decision
 * timestamp — an entry can never precede or postdate the decision that
 * opened it. Nothing here re-implements or duplicates the engine's own
 * `barsAsOf()` chokepoint; this only proves each new strategy's signals
 * flow through it correctly, exactly as the 4 Fase 11 baselines already do.
 */
function baseConfig(strategyId: string): ReplayConfig {
  return {
    assetSymbols: ["BTC"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-07-01T00:00:00.000Z"), // ~6 months, enough bars for at least some of these (more selective) signals to fire
    strategyId,
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10_000,
    riskLevel: 6,
  };
}

describe("Fase 17 research strategies — structural integrity over a real SYNTHETIC replay", () => {
  for (const strategyDef of RESEARCH_STRATEGY_REGISTRY) {
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
