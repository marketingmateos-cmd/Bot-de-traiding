import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runIsValidationOosReplay } from "@/lib/replay/segments";
import { runReplayWalkForward } from "@/lib/replay/replayWalkForward";
import { SUPPLEMENTARY_WALK_FORWARD_OPTIONS as FROZEN_WALK_FORWARD_OPTIONS } from "../hypothesisValidation";
import { toJson } from "@/lib/json";
import type { ReplayConfig } from "@/lib/replay/types";

/**
 * Fase 18 spec section 27 — the tests here focus specifically on what
 * Fase 7D's own `segments.test.ts` does NOT already cover: causal warm-up
 * across a segment boundary, a segment-scoped no-lookahead check tied to
 * `decisionIndex`, determinism of a full IS/VALIDATION/OOS run, chronological
 * walk-forward ordering, and — critically — that none of this new Fase 18
 * orchestration ever touches a pre-existing `StrategyBenchmarkResult` row.
 * Uses SYNTHETIC data throughout (deterministic, no real-dataset dependency,
 * same convention `segments.test.ts`/`replayWalkForward.test.ts` already use)
 * — real-dataset execution is covered by the Fase 18 report's own run, not
 * re-tested here.
 */

function baseConfig(overrides: Partial<ReplayConfig> = {}): ReplayConfig {
  return {
    assetSymbols: ["BTC"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-01-01T00:00:00.000Z"),
    strategyId: "trend-following",
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 20000,
    riskLevel: 5,
    ...overrides,
  };
}

const ranges = {
  is: { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-02-01T00:00:00.000Z") },
  validation: { start: new Date("2024-02-01T01:00:00.000Z"), end: new Date("2024-02-15T00:00:00.000Z") },
  oos: { start: new Date("2024-02-15T01:00:00.000Z"), end: new Date("2024-03-01T00:00:00.000Z") },
};

describe("Fase 18 — warm-up is causal across a segment boundary (spec sections 19/20/21)", () => {
  it("VALIDATION produces its first decision within the first WARMUP_BARS(60) hours of its own start — proving indicators were warm from IS carryover, never cold-started", async () => {
    const result = await runIsValidationOosReplay(baseConfig(), ranges, new Map());
    expect(result.validation.decisions.length).toBeGreaterThan(0); // sanity — this scenario should actually produce decisions
    const firstDecisionMs = Math.min(...result.validation.decisions.map((d) => new Date(d.timestamp).getTime()));
    // A COLD start (no warmup from IS) would make the first ~60 candles of
    // VALIDATION structurally incapable of producing any decision at all
    // (window.length < WARMUP_BARS) — so a decision inside that window is
    // only possible because indicators carried real, causal history from IS.
    expect(firstDecisionMs).toBeLessThan(ranges.validation.start.getTime() + 60 * 3_600_000);
  });

  it("no decision or trade in any segment ever falls outside that segment's own [start, end] window", async () => {
    const result = await runIsValidationOosReplay(baseConfig(), ranges, new Map());
    for (const [label, segment, range] of [
      ["IS", result.is, ranges.is],
      ["VALIDATION", result.validation, ranges.validation],
      ["OOS", result.oos, ranges.oos],
    ] as const) {
      for (const d of segment.decisions) {
        const t = new Date(d.timestamp).getTime();
        expect(t, `${label} decision outside its own window`).toBeGreaterThanOrEqual(range.start.getTime());
        expect(t, `${label} decision outside its own window`).toBeLessThanOrEqual(range.end.getTime());
      }
    }
  });
});

describe("Fase 18 — no lookahead within a segmented run (spec section 18)", () => {
  it("every trade's entryTime exactly matches its own decisionIndex's decision timestamp, within the SAME segment", async () => {
    const result = await runIsValidationOosReplay(baseConfig(), ranges, new Map());
    for (const segment of [result.is, result.validation, result.oos]) {
      for (const trade of segment.trades) {
        const decision = segment.decisions[trade.decisionIndex];
        expect(decision).toBeDefined();
        expect(trade.entryTime).toBe(decision.timestamp);
      }
    }
  });
});

describe("Fase 18 — determinism of a full IS/VALIDATION/OOS run (spec sections 9/27/28)", () => {
  it("the exact same config + ranges produce byte-identical trades/metrics for all 3 segments across two separate runs", async () => {
    const runA = await runIsValidationOosReplay(baseConfig(), ranges, new Map());
    const runB = await runIsValidationOosReplay(baseConfig(), ranges, new Map());
    expect(runB.is.trades).toEqual(runA.is.trades);
    expect(runB.is.metrics).toEqual(runA.is.metrics);
    expect(runB.validation.trades).toEqual(runA.validation.trades);
    expect(runB.validation.metrics).toEqual(runA.validation.metrics);
    expect(runB.oos.trades).toEqual(runA.oos.trades);
    expect(runB.oos.metrics).toEqual(runA.oos.metrics);
  });
});

describe("Fase 18 — walk-forward windows are strictly chronological (spec section 10)", () => {
  it("uses the FROZEN supplementary walk-forward options and produces windows with non-decreasing, non-overlapping train->oos ranges", async () => {
    const config = baseConfig({ endDate: new Date("2024-08-01T00:00:00.000Z") });
    const { walkForward } = await runReplayWalkForward(config, { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-08-01T00:00:00.000Z") }, FROZEN_WALK_FORWARD_OPTIONS, new Map());
    expect(walkForward.windows.length).toBeGreaterThan(0);
    for (let i = 0; i < walkForward.windows.length; i++) {
      const w = walkForward.windows[i];
      const trainStart = Date.parse(w.trainRange[0]);
      const trainEnd = Date.parse(w.trainRange[1]);
      const oosStart = Date.parse(w.oosRange[0]);
      const oosEnd = Date.parse(w.oosRange[1]);
      expect(trainStart).toBeLessThan(trainEnd);
      expect(oosStart).toBe(trainEnd); // train ends exactly where its own OOS test period begins
      expect(oosEnd).toBeGreaterThan(oosStart);
      if (i > 0) {
        const prevTrainStart = Date.parse(walkForward.windows[i - 1].trainRange[0]);
        expect(trainStart).toBeGreaterThan(prevTrainStart); // each window slides strictly forward
      }
    }
  });
});

describe("Fase 18 — never modifies a pre-existing StrategyBenchmarkResult (spec section 27 item 13)", () => {
  it("running a Fase 18-style segmented replay leaves an existing StrategyBenchmarkRun/Result row byte-for-byte unchanged", async () => {
    const run = await prisma.strategyBenchmarkRun.create({
      data: {
        datasetSymbol: "BTC",
        timeframe: "H1",
        startDate: new Date("2024-01-01T00:00:00.000Z"),
        endDate: new Date("2024-03-01T00:00:00.000Z"),
        evaluationProfileType: "20K",
        evaluationConfig: toJson({ fixture: true }),
        riskLevel: 5,
        status: "DONE",
      },
    });
    const result = await prisma.strategyBenchmarkResult.create({
      data: {
        benchmarkRunId: run.id,
        strategyId: "trend-following-baseline-v1",
        strategyName: "Fixture",
        strategyVersion: "1.0",
        strategyConfigHash: "deadbeef",
        replayRunId: "fixture-replay-run-id",
        metrics: toJson({ fixture: true }),
        evaluationStatus: "INCONCLUSIVE",
        score: toJson({ fixture: true }),
      },
    });

    try {
      await runIsValidationOosReplay(baseConfig(), ranges, new Map());

      const runAfter = await prisma.strategyBenchmarkRun.findUniqueOrThrow({ where: { id: run.id } });
      const resultAfter = await prisma.strategyBenchmarkResult.findUniqueOrThrow({ where: { id: result.id } });
      expect(runAfter).toEqual(run);
      expect(resultAfter).toEqual(result);
    } finally {
      await prisma.strategyBenchmarkResult.deleteMany({ where: { benchmarkRunId: run.id } });
      await prisma.strategyBenchmarkRun.delete({ where: { id: run.id } });
    }
  });
});
