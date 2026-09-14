import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await prisma.strategyBenchmarkRun.findUnique({ where: { id }, include: { results: true } });
  if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // Each StrategyBenchmarkResult points at a normal ReplayRun/ReplayResult
  // (spec section 21/22 — never duplicated) — fetch the equity/drawdown/
  // trades data for charting straight from there.
  const replayResults = await prisma.replayResult.findMany({
    where: { replayRunId: { in: run.results.map((r) => r.replayRunId) }, windowLabel: "FULL" },
  });
  const replayResultByReplayRunId = new Map(replayResults.map((r) => [r.replayRunId, r]));

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      datasetSymbol: run.datasetSymbol,
      timeframe: run.timeframe,
      startDate: run.startDate,
      endDate: run.endDate,
      evaluationProfileType: run.evaluationProfileType,
      evaluationConfig: fromJson(run.evaluationConfig, null),
      riskLevel: run.riskLevel,
      datasetId: run.datasetId,
      datasetHash: run.datasetHash,
      status: run.status,
      error: run.error,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      results: run.results.map((res) => {
        const replayResult = replayResultByReplayRunId.get(res.replayRunId);
        return {
          strategyId: res.strategyId,
          strategyName: res.strategyName,
          strategyVersion: res.strategyVersion,
          strategyConfigHash: res.strategyConfigHash,
          replayRunId: res.replayRunId,
          metrics: fromJson(res.metrics, null),
          evaluationStatus: res.evaluationStatus,
          score: fromJson(res.score, null),
          equityCurve: replayResult ? fromJson(replayResult.equityCurve, []) : [],
          drawdownCurve: replayResult ? fromJson(replayResult.drawdownCurve, []) : [],
          trades: replayResult ? fromJson(replayResult.trades, []) : [],
        };
      }),
    },
  });
}
