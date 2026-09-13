import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import { computeMarketDataCoverage } from "@/lib/marketData/coverage";
import type { TimeframeCode } from "@/lib/providers/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await prisma.replayRun.findUnique({ where: { id }, include: { results: true } });
  if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const assetSymbols = fromJson<string[]>(run.assetSymbols, []);

  // Fase 9/9.1.11 — only meaningful for a real replay: how much of this
  // run's assets' actually-imported real history exists, computed fresh
  // from MarketData every time (never cached/stale). The `source` filter
  // is deliberately OMITTED: DbBackedHistoricalMarketDataProvider (which
  // actually served this replay's bars) never filters by source either —
  // any real (isDemo:false) row counts, regardless of which import path
  // wrote it — so the coverage shown here must mirror that exactly rather
  // than assuming a single hardcoded source string like "binance" that
  // would silently miss rows imported via a CSV backfill. Each report's
  // own `sources` field then shows exactly which real source(s) were found.
  const marketDataCoverage =
    run.dataSource === "HISTORICAL_REAL" ? await Promise.all(assetSymbols.map((symbol) => computeMarketDataCoverage(symbol, run.timeframe as TimeframeCode))) : null;

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      strategyId: run.strategyId,
      assetSymbols,
      timeframe: run.timeframe,
      startDate: run.startDate,
      endDate: run.endDate,
      aiMode: run.aiMode,
      dataSource: run.dataSource,
      marketDataCoverage,
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
