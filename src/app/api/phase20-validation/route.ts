import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "@/lib/db";
import { toJson, fromJson } from "@/lib/json";
import { executeReplay } from "@/lib/replay/executeAndPersistReplay";
import { runReplayWalkForward } from "@/lib/replay/replayWalkForward";
import { fetchAndValidateReplayData } from "@/lib/replay/runReplay";
import { computeDescriptiveResearchStats } from "@/lib/research/researchStrategyStats";
import { classifyStrategyEvidence, type SegmentSummary } from "@/lib/research/phase18Evidence";
import { runBootstrapMonteCarlo, applyCostStress, type BootstrapOptions } from "@/lib/research/phase19MonteCarlo";
import { runFamilyADiscovery, runFamilyASegment, runFamilyAWalkForward, sliceBarsToRange } from "@/lib/research/phase20FamilyA";
import { compareHypothesisToStrategy } from "@/lib/research/phase20Comparison";
import { computeSessionDescriptiveStats } from "@/lib/research/phase20SessionAnalysis";
import { RESEARCH20_STRATEGY_REGISTRY } from "@/lib/engines/strategy/research20";
import {
  FROZEN_DATASET,
  FROZEN_RANGES,
  FROZEN_WALK_FORWARD_OPTIONS,
  FROZEN_STRESS_SCENARIOS,
  FROZEN_EVALUATION_PROFILE,
  FROZEN_MONTE_CARLO_CONFIG,
  RUIN_THRESHOLD_PCT,
  RETURN_THRESHOLDS_PCT,
  DRAWDOWN_THRESHOLDS_PCT,
  FROZEN_PHASE18_REPLAY_RUN_IDS,
  SEGMENT_LABELS,
  F20D_SESSIONS,
  FROZEN_RISK_LEVEL,
  FROZEN_INITIAL_CAPITAL,
} from "@/lib/research/phase20PreRegistration";
import type { ReplayConfig, ReplayMetrics, ReplayTradeRecord, ReplayDecisionRecord } from "@/lib/replay/types";

/**
 * Fase 20 — Nuevas Fuentes de Edge. Orquesta las 5 familias aprobadas
 * (Condiciones 1-15 de la autorización): F20-A como estudio estadístico
 * puro sobre bars (nunca convertido en estrategia), F20-B/C/E a través del
 * MISMO pipeline IS/VALIDATION/OOS + walk-forward + Monte Carlo/stress que
 * Fase 18/19 ya usaron para las 9 estrategias originales (reutilizado sin
 * modificar), y F20-D como análisis descriptivo retrospectivo sobre los
 * trades que Fase 18 YA produjo (nunca re-ejecutados). Nada aquí modifica
 * el dataset, las 9 estrategias congeladas, ni el comportamiento de
 * F15/F18/F19.
 */

async function loadPhase18Segment(strategyId: string, label: (typeof SEGMENT_LABELS)[number]) {
  const replayRunId = FROZEN_PHASE18_REPLAY_RUN_IDS[strategyId];
  const row = await prisma.replayResult.findFirst({ where: { replayRunId, windowLabel: label } });
  return {
    trades: row ? fromJson<ReplayTradeRecord[]>(row.trades, []) : [],
    decisions: row ? fromJson<ReplayDecisionRecord[]>(row.decisions, []) : [],
    metrics: row ? fromJson<ReplayMetrics>(row.metrics, null as unknown as ReplayMetrics) : null,
  };
}

export async function POST() {
  const dataset = await prisma.researchDataset.findFirst({ where: { symbol: FROZEN_DATASET.symbol, timeframe: FROZEN_DATASET.timeframe, source: "binance_csv" } });
  const mismatch =
    !dataset ||
    dataset.datasetHash !== FROZEN_DATASET.datasetHash ||
    dataset.rowCount !== FROZEN_DATASET.rowCount ||
    dataset.gapCount !== FROZEN_DATASET.gapCount ||
    dataset.duplicateCount !== FROZEN_DATASET.duplicateCount ||
    dataset.coveragePct !== FROZEN_DATASET.coveragePct ||
    dataset.isDemo !== FROZEN_DATASET.isDemo;
  if (mismatch || !dataset) {
    return NextResponse.json({ ok: false, error: "DATASET INTEGRITY GATE FAILED — Fase 20 detenida antes de ejecutar nada.", frozen: FROZEN_DATASET, found: dataset }, { status: 409 });
  }

  const asset = await prisma.asset.findUnique({ where: { symbol: FROZEN_DATASET.symbol } });
  if (!asset) return NextResponse.json({ ok: false, error: `No existe ningún Asset con symbol "${FROZEN_DATASET.symbol}".` }, { status: 400 });
  const assetIdBySymbol = new Map([[FROZEN_DATASET.symbol, asset.id]]);

  // ── F20-A — estudio estadístico puro (spec Condición 4) ──────────────
  const familyAConfig: ReplayConfig = {
    assetSymbols: [FROZEN_DATASET.symbol],
    timeframe: FROZEN_DATASET.timeframe,
    startDate: FROZEN_RANGES.is.start,
    endDate: FROZEN_RANGES.oos.end,
    strategyId: null,
    aiMode: "DETERMINISTIC_AI",
    dataSource: "HISTORICAL_REAL",
    initialCapital: FROZEN_INITIAL_CAPITAL,
    riskLevel: FROZEN_RISK_LEVEL,
    datasetId: dataset.id,
  };
  const { barsByAsset, dataQuality: familyADataQuality } = await fetchAndValidateReplayData(familyAConfig, assetIdBySymbol);
  const allBars = barsByAsset.get(FROZEN_DATASET.symbol) ?? [];

  const familyAResult = familyADataQuality.blocksReplay
    ? { blocked: true, warnings: familyADataQuality.warnings }
    : {
        blocked: false,
        discoveryIs: runFamilyADiscovery(sliceBarsToRange(allBars, FROZEN_RANGES.is)),
        validation: runFamilyASegment(sliceBarsToRange(allBars, FROZEN_RANGES.validation)),
        oos: runFamilyASegment(sliceBarsToRange(allBars, FROZEN_RANGES.oos)),
        walkForward: runFamilyAWalkForward(allBars, { start: FROZEN_RANGES.is.start, end: FROZEN_RANGES.oos.end }, FROZEN_WALK_FORWARD_OPTIONS),
      };

  // ── F20-D — análisis descriptivo de sesión sobre trades YA existentes (spec Condición 6) ──
  const familyDResults: unknown[] = [];
  for (const strategyId of Object.keys(FROZEN_PHASE18_REPLAY_RUN_IDS)) {
    const segments: unknown[] = [];
    for (const label of SEGMENT_LABELS) {
      const { trades } = await loadPhase18Segment(strategyId, label);
      segments.push({ label, tradeCount: trades.length, bySession: computeSessionDescriptiveStats(trades, F20D_SESSIONS) });
    }
    familyDResults.push({ strategyId, segments });
  }

  // ── F20-B/C/E — mismo pipeline que Fase 18/19 (spec Condición 5) ─────
  const bootstrapOptionsBase: BootstrapOptions = {
    iterations: FROZEN_MONTE_CARLO_CONFIG.iterations,
    seed: FROZEN_MONTE_CARLO_CONFIG.seed,
    initialEquity: FROZEN_EVALUATION_PROFILE.initialBalance,
    evaluationProfile: FROZEN_EVALUATION_PROFILE,
    ruinThresholdPct: RUIN_THRESHOLD_PCT,
    returnThresholdsPct: [...RETURN_THRESHOLDS_PCT],
    drawdownThresholdsPct: [...DRAWDOWN_THRESHOLDS_PCT],
  };

  const familyResults: unknown[] = [];

  for (const strategyDef of RESEARCH20_STRATEGY_REGISTRY) {
    const strategyId = strategyDef.id;
    const config: ReplayConfig = {
      assetSymbols: [FROZEN_DATASET.symbol],
      timeframe: FROZEN_DATASET.timeframe,
      startDate: FROZEN_RANGES.is.start,
      endDate: FROZEN_RANGES.oos.end,
      strategyId,
      aiMode: "DETERMINISTIC_AI",
      dataSource: "HISTORICAL_REAL",
      initialCapital: FROZEN_INITIAL_CAPITAL,
      riskLevel: FROZEN_RISK_LEVEL,
      datasetId: dataset.id,
    };

    const replayRunId = await executeReplay({ config, segments: FROZEN_RANGES });
    const replayRun = await prisma.replayRun.findUniqueOrThrow({ where: { id: replayRunId } });
    if (replayRun.status === "FAILED") {
      familyResults.push({ strategyId, replayRunId, error: replayRun.error });
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

    const wf = await runReplayWalkForward(config, { start: FROZEN_RANGES.is.start, end: FROZEN_RANGES.oos.end }, FROZEN_WALK_FORWARD_OPTIONS, assetIdBySymbol);
    await prisma.replayRun.update({ where: { id: replayRunId }, data: { walkForward: toJson(wf.walkForward), hasWalkForward: true } });

    const wfWindows = wf.walkForward.windows.map((w) => {
      const wt = wf.windowTrades.find((x) => x.windowIndex === w.windowIndex);
      const stats = wt ? computeDescriptiveResearchStats(wt.oosTrades, wt.oosDecisions) : null;
      return { windowIndex: w.windowIndex, trainRange: w.trainRange, oosRange: w.oosRange, trainMetrics: w.trainMetrics, oosMetrics: w.oosMetrics, degraded: w.degraded, oosAvgR: stats?.avgR ?? null, oosTradesCount: stats?.numTrades ?? 0 };
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

    // ── Costes/slippage stress + Monte Carlo (spec Condición 5) — mismos escenarios/infra que Fase 19, aplicados a los trades NUEVOS de esta familia ──
    const segmentsForMc = [
      { label: "IS", trades: is.trades },
      { label: "VALIDATION", trades: validation.trades },
      { label: "OOS", trades: oos.trades },
    ];
    const monteCarlo = segmentsForMc.map(({ label, trades }) => {
      if (trades.length === 0) return { label, tradeCount: 0, insufficientSample: true, stressResults: [] };
      const stressResults = FROZEN_STRESS_SCENARIOS.map((scenario) => {
        const stressedTrades = scenario.id === "BASE" ? trades : applyCostStress(trades, scenario);
        return { scenarioId: scenario.id, label: scenario.label, aggregate: runBootstrapMonteCarlo(stressedTrades, bootstrapOptionsBase) };
      });
      return { label, tradeCount: trades.length, insufficientSample: false, stressResults };
    });

    // ── Comparación de edge incremental (spec Condición 7/8) ──────────
    // Se ejecuta SIEMPRE para F20-E frente a F17-A (Condición 7, obligatorio
    // independientemente del resultado); para las demás, solo cuando la
    // hipótesis alcanza al menos WEAK_SUPPORT (Condición 8: "para cualquier
    // hipótesis con evidencia prometedora").
    const shouldCompare = classification.status === "SUPPORTED" || classification.status === "WEAK_SUPPORT" || strategyDef.id === "research20-compression-duration-v1";
    let incrementalComparison: unknown[] = [];
    if (shouldCompare) {
      const comparisonTargets =
        strategyDef.id === "research20-compression-duration-v1" ? ["research-volatility-squeeze-v1"] : Object.keys(FROZEN_PHASE18_REPLAY_RUN_IDS);
      incrementalComparison = await Promise.all(
        comparisonTargets.map(async (otherStrategyId) => {
          const otherOos = await loadPhase18Segment(otherStrategyId, "OOS");
          return compareHypothesisToStrategy(oos.trades, otherOos.trades, otherStrategyId);
        })
      );
    }

    familyResults.push({
      strategyId,
      replayRunId,
      is: { metrics: is.metrics, stats: isStats },
      validation: { metrics: validation.metrics, stats: validationStats },
      oos: { metrics: oos.metrics, stats: oosStats },
      walkForward: { windows: wfWindows, aggregate: wf.walkForward.aggregateOosMetrics },
      classification,
      monteCarlo,
      incrementalComparison,
    });
  }

  const payload = {
    ok: true,
    datasetHash: dataset.datasetHash,
    ranges: FROZEN_RANGES,
    familyA: familyAResult,
    familyBCE: familyResults,
    familyD: familyDResults,
  };

  try {
    writeFileSync(join(tmpdir(), "phase20-validation-result.json"), JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    /* best-effort only */
  }

  return NextResponse.json(payload);
}
