import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeRegimeAnalysis } from "@/lib/research/regimeAnalysis";
import { computeIsValidationOosRanges } from "@/lib/research/hypothesisValidation";
import { runIsValidationOosReplay, type IsValidationOosRanges } from "@/lib/replay/segments";
import type { ReplayConfig } from "@/lib/replay/types";

interface StabilityCheckBody {
  /** Opt-in (spec section 11): which strategies from this run to check. Omit/empty = every strategy in the run. */
  strategyIds?: string[];
}

/**
 * Fase 12 — spec section 11 (stability, NOT optimization): reuses the
 * EXISTING IS/VALIDATION/OOS replay infrastructure (`runIsValidationOosReplay`,
 * Fase 7D) with the strategy's EXACT baseline config — same strategyId, same
 * dataset, same risk/fees/slippage, no `strategyParamsOverride` — to see
 * whether the regime patterns found in the full run's IS-equivalent window
 * also appear in VALIDATION/OOS. Computed on demand and never persisted:
 * this is a research read, not a new artifact, and running it twice with the
 * same input always reproduces the same three segments (DETERMINISTIC_AI,
 * no randomness) — nothing here can feed back into the baseline strategy or
 * choose a winner (spec section 13/14).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await prisma.strategyBenchmarkRun.findUnique({ where: { id }, include: { results: true } });
  if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Partial<StabilityCheckBody>;
  const requestedIds = body.strategyIds && body.strategyIds.length > 0 ? new Set(body.strategyIds) : null;
  const targets = run.results.filter((r) => !requestedIds || requestedIds.has(r.strategyId));
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "No matching strategyIds in this benchmark run." }, { status: 400 });
  }

  const computedRanges = computeIsValidationOosRanges(run.startDate, run.endDate);
  if (!computedRanges) {
    const totalDays = (run.endDate.getTime() - run.startDate.getTime()) / (24 * 60 * 60_000);
    return NextResponse.json({ ok: false, error: `El rango (${totalDays.toFixed(1)} días) es demasiado corto para segmentar en IS/VALIDATION/OOS.` }, { status: 400 });
  }
  const ranges: IsValidationOosRanges = computedRanges;

  const asset = await prisma.asset.findUnique({ where: { symbol: run.datasetSymbol } });
  if (!asset) return NextResponse.json({ ok: false, error: `No existe ningún Asset con symbol "${run.datasetSymbol}".` }, { status: 400 });
  const assetIdBySymbol = new Map([[run.datasetSymbol, asset.id]]);

  const replayRuns = await prisma.replayRun.findMany({ where: { id: { in: targets.map((t) => t.replayRunId) } } });
  const replayRunByReplayRunId = new Map(replayRuns.map((r) => [r.id, r]));

  const strategies = await Promise.all(
    targets.map(async (target) => {
      const replayRun = replayRunByReplayRunId.get(target.replayRunId);
      if (!replayRun) return { strategyId: target.strategyId, strategyName: target.strategyName, error: "Underlying ReplayRun not found." };

      // The strategy's EXACT baseline config as it was actually run — never a new/altered one (spec section 14).
      const config: ReplayConfig = {
        assetSymbols: [run.datasetSymbol],
        timeframe: run.timeframe as ReplayConfig["timeframe"],
        startDate: ranges.is.start,
        endDate: ranges.oos.end,
        strategyId: target.strategyId,
        aiMode: replayRun.aiMode as ReplayConfig["aiMode"],
        dataSource: replayRun.dataSource as ReplayConfig["dataSource"],
        initialCapital: replayRun.initialCapital,
        riskLevel: replayRun.riskLevel,
      };

      const { is, validation, oos, dataQuality } = await runIsValidationOosReplay(config, ranges, assetIdBySymbol);

      return {
        strategyId: target.strategyId,
        strategyName: target.strategyName,
        ranges: {
          is: { start: ranges.is.start, end: ranges.is.end },
          validation: { start: ranges.validation.start, end: ranges.validation.end },
          oos: { start: ranges.oos.start, end: ranges.oos.end },
        },
        dataQuality,
        is: { metrics: is.metrics, regimeAnalysis: computeRegimeAnalysis(is.trades, is.decisions) },
        validation: { metrics: validation.metrics, regimeAnalysis: computeRegimeAnalysis(validation.trades, validation.decisions) },
        oos: { metrics: oos.metrics, regimeAnalysis: computeRegimeAnalysis(oos.trades, oos.decisions) },
      };
    })
  );

  return NextResponse.json({ ok: true, benchmarkRunId: run.id, strategies });
}
