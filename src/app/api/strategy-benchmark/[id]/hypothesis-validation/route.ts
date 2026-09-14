import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import {
  STABILITY_SCORE_FORMULA,
  analyzeMarketEvent,
  buildHypothesisResult,
  computeIsValidationOosRanges,
  isBearRegime,
  isHighVolatilityRegime,
  isRangeRegime,
  type HypothesisResult,
  type SegmentedTradeData,
} from "@/lib/research/hypothesisValidation";
import { runIsValidationOosReplay, type IsValidationOosRanges } from "@/lib/replay/segments";
import type { ReplayConfig, ReplayDecisionRecord, ReplayTradeRecord } from "@/lib/replay/types";

// The exact historical window Fase 12 flagged (spec section 9 / H5) as a
// striking cross-strategy loss cluster — every strategy's single largest
// loss fell here. A small margin (one day either side of the observed
// 06-03..06-07 trades) so a position opened just before/after the window
// is still counted as overlapping it.
const MARKET_EVENT_START = new Date("2026-06-02T00:00:00.000Z");
const MARKET_EVENT_END = new Date("2026-06-08T00:00:00.000Z");

interface HypothesisValidationBody {
  /** Opt-in-ish: which strategies to include (default: every strategy in the run). H3/H4 only ever apply to Trend Following / Momentum regardless of this filter. */
  strategyIds?: string[];
}

/**
 * Fase 13 — Hypothesis Validation & Walk-Forward. Re-runs the SAME
 * IS/VALIDATION/OOS split Fase 12's stability-check uses (spec section 3:
 * a single, non-overlapping, chronological 60/20/20 split — see this
 * route's own doc comment on why a MULTI-window split was not fabricated)
 * for every strategy, then asks whether each Fase 12 hypothesis (H1-H4)
 * holds in every segment, plus a dedicated H5 market-event analysis over
 * the FULL run's already-persisted trades (no re-run needed for H5 — the
 * event is a fixed historical window, not a temporal split). Nothing here
 * is persisted: like Fase 12's stability-check, this is a research read,
 * deterministic and reproducible on every call.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await prisma.strategyBenchmarkRun.findUnique({ where: { id }, include: { results: true } });
  if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Partial<HypothesisValidationBody>;
  const requestedIds = body.strategyIds && body.strategyIds.length > 0 ? new Set(body.strategyIds) : null;
  const targets = run.results.filter((r) => !requestedIds || requestedIds.has(r.strategyId));
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "No matching strategyIds in this benchmark run." }, { status: 400 });
  }

  const ranges = computeIsValidationOosRanges(run.startDate, run.endDate);
  if (!ranges) {
    const totalDays = (run.endDate.getTime() - run.startDate.getTime()) / (24 * 60 * 60_000);
    return NextResponse.json({ ok: false, error: `El rango (${totalDays.toFixed(1)} días) es demasiado corto para segmentar en IS/VALIDATION/OOS.` }, { status: 400 });
  }
  const segmentRanges: IsValidationOosRanges = ranges;

  const asset = await prisma.asset.findUnique({ where: { symbol: run.datasetSymbol } });
  if (!asset) return NextResponse.json({ ok: false, error: `No existe ningún Asset con symbol "${run.datasetSymbol}".` }, { status: 400 });
  const assetIdBySymbol = new Map([[run.datasetSymbol, asset.id]]);

  const replayRuns = await prisma.replayRun.findMany({ where: { id: { in: targets.map((t) => t.replayRunId) } } });
  const replayRunByReplayRunId = new Map(replayRuns.map((r) => [r.id, r]));

  // ── Step 1: re-run each target strategy's EXACT baseline config split into IS/VALIDATION/OOS (spec section 14 — no parameter changes) ──
  const perStrategySegments = await Promise.all(
    targets.map(async (target) => {
      const replayRun = replayRunByReplayRunId.get(target.replayRunId);
      if (!replayRun) return { strategyId: target.strategyId, strategyName: target.strategyName, error: "Underlying ReplayRun not found.", segments: null as SegmentedTradeData[] | null };

      const config: ReplayConfig = {
        assetSymbols: [run.datasetSymbol],
        timeframe: run.timeframe as ReplayConfig["timeframe"],
        startDate: segmentRanges.is.start,
        endDate: segmentRanges.oos.end,
        strategyId: target.strategyId,
        aiMode: replayRun.aiMode as ReplayConfig["aiMode"],
        dataSource: replayRun.dataSource as ReplayConfig["dataSource"],
        initialCapital: replayRun.initialCapital,
        riskLevel: replayRun.riskLevel,
      };

      const { is, validation, oos } = await runIsValidationOosReplay(config, segmentRanges, assetIdBySymbol);
      const segments: SegmentedTradeData[] = [
        { label: "IS", range: segmentRanges.is, trades: is.trades, decisions: is.decisions },
        { label: "VALIDATION", range: segmentRanges.validation, trades: validation.trades, decisions: validation.decisions },
        { label: "OOS", range: segmentRanges.oos, trades: oos.trades, decisions: oos.decisions },
      ];
      return { strategyId: target.strategyId, strategyName: target.strategyName, error: null as string | null, segments };
    })
  );

  // ── Step 2: H1 (RANGE) and H2 (HIGH_VOLATILITY) for every strategy that ran successfully ──
  const hypotheses: HypothesisResult[] = [];
  for (const s of perStrategySegments) {
    if (!s.segments) continue;
    hypotheses.push(buildHypothesisResult(`H1_RANGE_${s.strategyId}`, "H1 — RANGE es desfavorable frente a NON-RANGE", s.strategyId, s.strategyName, "LOWER", isRangeRegime, s.segments));
    hypotheses.push(buildHypothesisResult(`H2_HIGH_VOLATILITY_${s.strategyId}`, "H2 — HIGH_VOLATILITY es relativamente menos desfavorable que NON-HIGH_VOLATILITY", s.strategyId, s.strategyName, "HIGHER", isHighVolatilityRegime, s.segments));
  }

  // ── Step 3: H3 (Trend Following / BEAR) and H4 (Momentum / BEAR) — only for their named strategy (spec sections 7/8) ──
  const trendFollowing = perStrategySegments.find((s) => s.strategyId === "trend-following-baseline-v1");
  if (trendFollowing?.segments) {
    hypotheses.push(buildHypothesisResult("H3_TREND_FOLLOWING_BEAR", "H3 — Trend Following es relativamente menos desfavorable en BEAR", trendFollowing.strategyId, trendFollowing.strategyName, "HIGHER", isBearRegime, trendFollowing.segments));
  }
  const momentum = perStrategySegments.find((s) => s.strategyId === "momentum-baseline-v1");
  if (momentum?.segments) {
    hypotheses.push(buildHypothesisResult("H4_MOMENTUM_BEAR", "H4 — Momentum es relativamente menos desfavorable en BEAR", momentum.strategyId, momentum.strategyName, "HIGHER", isBearRegime, momentum.segments));
  }

  // ── Step 4: H5 — market event, using the FULL run's ALREADY-persisted trades (no re-run needed: this is a fixed historical window, not a temporal split) ──
  const replayResults = await prisma.replayResult.findMany({ where: { replayRunId: { in: targets.map((t) => t.replayRunId) }, windowLabel: "FULL" } });
  const replayResultByReplayRunId = new Map(replayResults.map((r) => [r.replayRunId, r]));
  const perStrategyFull = targets.map((target) => {
    const replayResult = replayResultByReplayRunId.get(target.replayRunId);
    return {
      strategyId: target.strategyId,
      strategyName: target.strategyName,
      trades: replayResult ? fromJson<ReplayTradeRecord[]>(replayResult.trades, []) : [],
      decisions: replayResult ? fromJson<ReplayDecisionRecord[]>(replayResult.decisions, []) : [],
    };
  });
  const marketEvent = analyzeMarketEvent(perStrategyFull, MARKET_EVENT_START, MARKET_EVENT_END);

  return NextResponse.json({
    ok: true,
    benchmarkRunId: run.id,
    segmentRanges: {
      is: { start: segmentRanges.is.start, end: segmentRanges.is.end },
      validation: { start: segmentRanges.validation.start, end: segmentRanges.validation.end },
      oos: { start: segmentRanges.oos.start, end: segmentRanges.oos.end },
    },
    hypotheses,
    marketEvent,
    stabilityScoreFormula: STABILITY_SCORE_FORMULA,
    errors: perStrategySegments.filter((s) => s.error).map((s) => ({ strategyId: s.strategyId, error: s.error })),
  });
}
