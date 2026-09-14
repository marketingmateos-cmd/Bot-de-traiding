import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "@/lib/db";
import { toJson, fromJson } from "@/lib/json";
import { executeReplay } from "@/lib/replay/executeAndPersistReplay";
import { runReplayWalkForward } from "@/lib/replay/replayWalkForward";
import { computeRegimeAnalysis } from "@/lib/research/regimeAnalysis";
import { computeDescriptiveResearchStats } from "@/lib/research/researchStrategyStats";
import { classifyStrategyEvidence, type SegmentSummary } from "@/lib/research/phase18Evidence";
import { FROZEN_DATASET, FROZEN_RANGES, FROZEN_STRATEGY_IDS, FROZEN_WALK_FORWARD_OPTIONS, FROZEN_RISK_PROFILE } from "@/lib/research/phase18PreRegistration";
import type { ReplayConfig, ReplayMetrics, ReplayTradeRecord, ReplayDecisionRecord } from "@/lib/replay/types";

/**
 * Fase 18 — Out-of-Sample + Walk-Forward Validation. Orchestrates the 9
 * FROZEN strategies (spec section 22: "no crear nuevas estrategias
 * durante esta fase") over the FROZEN IS/VALIDATION/OOS partition and the
 * FROZEN supplementary walk-forward config, reusing `executeReplay`
 * (Fase 7/8, unmodified) and `runReplayWalkForward` (Fase 7E, only
 * additively extended in this phase to also return per-window trades —
 * see that file's own doc comment) for every actual simulation. This
 * route computes no new trade, applies no new execution rule, and never
 * adjusts any parameter based on what it observes — it only orchestrates
 * already-existing replay calls and post-processes their already-computed
 * output (spec sections 3/8/11 of Fase 13's own module, reused here).
 */
export async function POST() {
  // ── Spec section 17 — DATA INTEGRITY GATE. Must run before anything else. ──
  const dataset = await prisma.researchDataset.findFirst({ where: { symbol: FROZEN_DATASET.symbol, timeframe: FROZEN_DATASET.timeframe, source: "binance_csv" } });
  const mismatch =
    !dataset ||
    dataset.datasetHash !== FROZEN_DATASET.datasetHash ||
    dataset.rowCount !== FROZEN_DATASET.rowCount ||
    dataset.gapCount !== FROZEN_DATASET.gapCount ||
    dataset.duplicateCount !== FROZEN_DATASET.duplicateCount ||
    dataset.coveragePct !== FROZEN_DATASET.coveragePct ||
    dataset.isDemo !== FROZEN_DATASET.isDemo;
  if (mismatch) {
    return NextResponse.json(
      { ok: false, error: "DATASET INTEGRITY GATE FAILED — Fase 18 detenida antes de ejecutar nada. El dataset actual no coincide con el congelado en Fase 16.", frozen: FROZEN_DATASET, found: dataset },
      { status: 409 }
    );
  }

  const asset = await prisma.asset.findUnique({ where: { symbol: FROZEN_DATASET.symbol } });
  if (!asset) return NextResponse.json({ ok: false, error: `No existe ningún Asset con symbol "${FROZEN_DATASET.symbol}".` }, { status: 400 });
  const assetIdBySymbol = new Map([[FROZEN_DATASET.symbol, asset.id]]);

  const results: unknown[] = [];

  for (const strategyId of FROZEN_STRATEGY_IDS) {
    const config: ReplayConfig = {
      assetSymbols: [FROZEN_DATASET.symbol],
      timeframe: FROZEN_DATASET.timeframe,
      startDate: FROZEN_RANGES.is.start,
      endDate: FROZEN_RANGES.oos.end,
      strategyId,
      aiMode: FROZEN_RISK_PROFILE.aiMode,
      dataSource: FROZEN_RISK_PROFILE.dataSource,
      initialCapital: 20000, // spec section 16 — same €20K profile as the Fase 11/17 benchmark
      riskLevel: FROZEN_RISK_PROFILE.riskLevel,
      datasetId: dataset.id,
    };

    const replayRunId = await executeReplay({ config, segments: FROZEN_RANGES });
    const replayRun = await prisma.replayRun.findUniqueOrThrow({ where: { id: replayRunId } });
    if (replayRun.status === "FAILED") {
      results.push({ strategyId, replayRunId, error: replayRun.error });
      continue;
    }

    const [isRow, validationRow, oosRow] = await Promise.all([
      prisma.replayResult.findFirstOrThrow({ where: { replayRunId, windowLabel: "IS" } }),
      prisma.replayResult.findFirstOrThrow({ where: { replayRunId, windowLabel: "VALIDATION" } }),
      prisma.replayResult.findFirstOrThrow({ where: { replayRunId, windowLabel: "OOS" } }),
    ]);

    const parseSeg = (row: { metrics: string; trades: string; decisions: string }) => ({
      metrics: fromJson<ReplayMetrics>(row.metrics, null as unknown as ReplayMetrics),
      trades: fromJson<ReplayTradeRecord[]>(row.trades, []),
      decisions: fromJson<ReplayDecisionRecord[]>(row.decisions, []),
    });
    const is = parseSeg(isRow);
    const validation = parseSeg(validationRow);
    const oos = parseSeg(oosRow);

    const isStats = computeDescriptiveResearchStats(is.trades, is.decisions);
    const validationStats = computeDescriptiveResearchStats(validation.trades, validation.decisions);
    const oosStats = computeDescriptiveResearchStats(oos.trades, oos.decisions);

    // Supplementary walk-forward (spec section 10) — ONE call, reusing the
    // FROZEN options exactly as Fase 13 already froze them. Persisted onto
    // the SAME ReplayRun row, in the SAME shape `executeReplay` itself would
    // have stored had `walkForward` been passed to it directly.
    const wf = await runReplayWalkForward(config, { start: FROZEN_RANGES.is.start, end: FROZEN_RANGES.oos.end }, FROZEN_WALK_FORWARD_OPTIONS, assetIdBySymbol);
    await prisma.replayRun.update({ where: { id: replayRunId }, data: { walkForward: toJson(wf.walkForward), hasWalkForward: true } });

    const wfWindows = wf.walkForward.windows.map((w) => {
      const wt = wf.windowTrades.find((x) => x.windowIndex === w.windowIndex);
      const stats = wt ? computeDescriptiveResearchStats(wt.oosTrades, wt.oosDecisions) : null;
      return {
        windowIndex: w.windowIndex,
        trainRange: w.trainRange,
        oosRange: w.oosRange,
        trainMetrics: w.trainMetrics,
        oosMetrics: w.oosMetrics,
        degraded: w.degraded,
        oosAvgR: stats?.avgR ?? null,
        oosMedianR: stats?.medianR ?? null,
        oosTradesCount: stats?.numTrades ?? 0,
      };
    });
    const positiveWindows = wfWindows.filter((w) => w.oosMetrics.totalReturnPct > 0).length;

    const segSummary = (metrics: ReplayMetrics, stats: ReturnType<typeof computeDescriptiveResearchStats>): SegmentSummary => ({
      trades: metrics.trades,
      returnPct: metrics.totalReturnPct,
      profitFactor: metrics.profitFactor,
      avgR: stats.avgR,
      maxDrawdownPct: metrics.maxDrawdownPct,
      expectancy: metrics.expectancy,
      longCount: stats.longCount,
      shortCount: stats.shortCount,
    });

    const classification = classifyStrategyEvidence(segSummary(is.metrics, isStats), segSummary(validation.metrics, validationStats), segSummary(oos.metrics, oosStats), {
      windowCount: wfWindows.length,
      positiveWindowFraction: wfWindows.length > 0 ? positiveWindows / wfWindows.length : 0,
    });

    results.push({
      strategyId,
      replayRunId,
      is: { metrics: is.metrics, stats: isStats, regime: computeRegimeAnalysis(is.trades, is.decisions) },
      validation: { metrics: validation.metrics, stats: validationStats, regime: computeRegimeAnalysis(validation.trades, validation.decisions) },
      oos: { metrics: oos.metrics, stats: oosStats, regime: computeRegimeAnalysis(oos.trades, oos.decisions) },
      walkForward: { windows: wfWindows, aggregate: wf.walkForward.aggregateOosMetrics },
      classification,
    });
  }

  const payload = { ok: true, datasetHash: dataset.datasetHash, ranges: FROZEN_RANGES, results };

  // Durability safeguard: this run can take a long time; write the full
  // aggregated payload to disk too, so it can be recovered even if the HTTP
  // client that triggered this POST disconnects/times out before the
  // response is sent (the route itself still runs to completion either way).
  try {
    writeFileSync(join(tmpdir(), "phase18-validation-result.json"), JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    /* best-effort only */
  }

  return NextResponse.json(payload);
}
