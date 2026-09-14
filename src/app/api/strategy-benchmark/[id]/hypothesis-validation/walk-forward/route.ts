import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SUPPLEMENTARY_WALK_FORWARD_OPTIONS, WALK_FORWARD_LIMITATION_NOTE } from "@/lib/research/hypothesisValidation";
import { runReplayWalkForward } from "@/lib/replay/replayWalkForward";
import type { ReplayConfig } from "@/lib/replay/types";

interface WalkForwardValidationBody {
  strategyIds?: string[];
}

/**
 * Fase 13 spec section 4 — the supplementary, NON-regime-decomposed
 * walk-forward check. Reuses the EXISTING (Fase 7E) `runReplayWalkForward`
 * unmodified, with fixed documented window parameters
 * (`SUPPLEMENTARY_WALK_FORWARD_OPTIONS`). Deliberately a separate, opt-in
 * endpoint from `.../hypothesis-validation` — it is the more expensive of
 * the two checks (each window replays the full history up to that
 * window's end) and the two questions are genuinely different: the main
 * endpoint asks "does the regime effect hold in IS/VALIDATION/OOS", this
 * one asks "does the strategy's raw performance hold up across sliding
 * windows" at a coarser, non-regime-specific level (see
 * WALK_FORWARD_LIMITATION_NOTE for why it stays coarse).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await prisma.strategyBenchmarkRun.findUnique({ where: { id }, include: { results: true } });
  if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Partial<WalkForwardValidationBody>;
  const requestedIds = body.strategyIds && body.strategyIds.length > 0 ? new Set(body.strategyIds) : null;
  const targets = run.results.filter((r) => !requestedIds || requestedIds.has(r.strategyId));
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "No matching strategyIds in this benchmark run." }, { status: 400 });
  }

  const asset = await prisma.asset.findUnique({ where: { symbol: run.datasetSymbol } });
  if (!asset) return NextResponse.json({ ok: false, error: `No existe ningún Asset con symbol "${run.datasetSymbol}".` }, { status: 400 });
  const assetIdBySymbol = new Map([[run.datasetSymbol, asset.id]]);

  const replayRuns = await prisma.replayRun.findMany({ where: { id: { in: targets.map((t) => t.replayRunId) } } });
  const replayRunByReplayRunId = new Map(replayRuns.map((r) => [r.id, r]));

  const strategies = await Promise.all(
    targets.map(async (target) => {
      const replayRun = replayRunByReplayRunId.get(target.replayRunId);
      if (!replayRun) return { strategyId: target.strategyId, strategyName: target.strategyName, error: "Underlying ReplayRun not found." };

      const config: ReplayConfig = {
        assetSymbols: [run.datasetSymbol],
        timeframe: run.timeframe as ReplayConfig["timeframe"],
        startDate: run.startDate,
        endDate: run.endDate,
        strategyId: target.strategyId,
        aiMode: replayRun.aiMode as ReplayConfig["aiMode"],
        dataSource: replayRun.dataSource as ReplayConfig["dataSource"],
        initialCapital: replayRun.initialCapital,
        riskLevel: replayRun.riskLevel,
      };

      const { walkForward } = await runReplayWalkForward(config, { start: run.startDate, end: run.endDate }, SUPPLEMENTARY_WALK_FORWARD_OPTIONS, assetIdBySymbol);

      return {
        strategyId: target.strategyId,
        strategyName: target.strategyName,
        windows: walkForward.windows.map((w) => ({
          windowIndex: w.windowIndex,
          trainRange: w.trainRange,
          oosRange: w.oosRange,
          trainMetrics: { trades: w.trainMetrics.trades, totalReturnPct: w.trainMetrics.totalReturnPct, profitFactor: w.trainMetrics.profitFactor },
          oosMetrics: { trades: w.oosMetrics.trades, totalReturnPct: w.oosMetrics.totalReturnPct, profitFactor: w.oosMetrics.profitFactor },
          degraded: w.degraded,
        })),
        aggregateOosMetrics: walkForward.aggregateOosMetrics,
      };
    })
  );

  return NextResponse.json({ ok: true, benchmarkRunId: run.id, options: SUPPLEMENTARY_WALK_FORWARD_OPTIONS, note: WALK_FORWARD_LIMITATION_NOTE, strategies });
}
