import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await prisma.replayRun.findUnique({ where: { id }, include: { results: true } });
  if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      strategyId: run.strategyId,
      assetSymbols: fromJson<string[]>(run.assetSymbols, []),
      timeframe: run.timeframe,
      startDate: run.startDate,
      endDate: run.endDate,
      aiMode: run.aiMode,
      dataSource: run.dataSource,
      initialCapital: run.initialCapital,
      riskLevel: run.riskLevel,
      hasSegments: run.hasSegments,
      hasWalkForward: run.hasWalkForward,
      status: run.status,
      error: run.error,
      dataQualityReport: fromJson(run.dataQualityReport, null),
      walkForward: fromJson(run.walkForward, null),
      robustness: fromJson(run.robustness, null),
      overfitting: fromJson(run.overfitting, null),
      evidence: fromJson(run.evidence, null),
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      results: run.results.map((r) => ({
        windowLabel: r.windowLabel,
        metrics: fromJson(r.metrics, null),
        equityCurve: fromJson(r.equityCurve, []),
        drawdownCurve: fromJson(r.drawdownCurve, []),
        trades: fromJson(r.trades, []),
        decisions: fromJson(r.decisions, []),
      })),
    },
  });
}
