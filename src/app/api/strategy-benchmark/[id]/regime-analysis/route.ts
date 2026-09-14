import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import { computeRegimeAnalysis, computeStrategyRegimeMatrix } from "@/lib/research/regimeAnalysis";
import type { ReplayDecisionRecord, ReplayTradeRecord } from "@/lib/replay/types";

/**
 * Fase 12 — Regime-Aware Strategy Research (spec sections 1-10). Pure
 * on-demand post-processing over a Fase 11 `StrategyBenchmarkRun`'s ALREADY
 * persisted `ReplayResult.trades`/`.decisions` — never re-runs a replay,
 * never re-invokes the Regime Engine, never writes anything to the DB.
 * Cheap and deterministic to recompute on every GET, so nothing new needs
 * its own table (spec: "reutilizar, no duplicar").
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await prisma.strategyBenchmarkRun.findUnique({ where: { id }, include: { results: true } });
  if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const replayRunIds = run.results.map((r) => r.replayRunId);
  const [replayResults, replayRuns] = await Promise.all([
    prisma.replayResult.findMany({ where: { replayRunId: { in: replayRunIds }, windowLabel: "FULL" } }),
    prisma.replayRun.findMany({ where: { id: { in: replayRunIds } } }),
  ]);
  const replayResultByReplayRunId = new Map(replayResults.map((r) => [r.replayRunId, r]));
  const replayRunById = new Map(replayRuns.map((r) => [r.id, r]));

  const perStrategy: { strategyId: string; strategyName: string; trades: ReplayTradeRecord[]; decisions: ReplayDecisionRecord[] }[] = [];
  const strategies = run.results.map((res) => {
    const replayResult = replayResultByReplayRunId.get(res.replayRunId);
    const replayRun = replayRunById.get(res.replayRunId);
    const trades = replayResult ? fromJson<ReplayTradeRecord[]>(replayResult.trades, []) : [];
    const decisions = replayResult ? fromJson<ReplayDecisionRecord[]>(replayResult.decisions, []) : [];
    perStrategy.push({ strategyId: res.strategyId, strategyName: res.strategyName, trades, decisions });

    return {
      strategyId: res.strategyId,
      strategyName: res.strategyName,
      strategyVersion: res.strategyVersion,
      replayRunId: res.replayRunId,
      evaluationStatus: res.evaluationStatus,
      regimeAnalysis: computeRegimeAnalysis(trades, decisions),
      // Fase 11's executeReplay() already computed these for free — never re-derived here (spec section 12: "reutilizar robustez existente, no optimizar").
      robustness: replayRun ? fromJson(replayRun.robustness, null) : null,
      overfitting: replayRun ? fromJson(replayRun.overfitting, null) : null,
    };
  });

  return NextResponse.json({
    ok: true,
    benchmarkRunId: run.id,
    datasetSymbol: run.datasetSymbol,
    timeframe: run.timeframe,
    startDate: run.startDate,
    endDate: run.endDate,
    strategies,
    strategyRegimeMatrix: computeStrategyRegimeMatrix(perStrategy),
  });
}
