import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import {
  runBootstrapMonteCarlo,
  runBlockBootstrapMonteCarlo,
  applyCostStress,
  computeOutlierAnalysis,
  computeExpectancyStats,
  classifyRobustness,
  type BootstrapOptions,
} from "@/lib/research/phase19MonteCarlo";
import {
  FROZEN_DATASET,
  FROZEN_MONTE_CARLO_CONFIG,
  FROZEN_STRESS_SCENARIOS,
  FROZEN_EVALUATION_PROFILE,
  FROZEN_PHASE18_REPLAY_RUN_IDS,
  FROZEN_STRATEGY_IDS,
  SEGMENT_LABELS,
  MIN_SAMPLE_SIZE,
  MIN_TRADES_FOR_BLOCK_BOOTSTRAP,
  FROZEN_BLOCK_SIZE,
  RUIN_THRESHOLD_PCT,
  RETURN_THRESHOLDS_PCT,
  DRAWDOWN_THRESHOLDS_PCT,
} from "@/lib/research/phase19PreRegistration";
import type { ReplayMetrics, ReplayTradeRecord } from "@/lib/replay/types";

/**
 * Fase 19 — Robustness, Monte Carlo & Stress Testing. Reads trades ALREADY
 * produced and persisted by Fase 18 (never re-executes a strategy, never
 * re-fetches market data) and runs the frozen bootstrap/stress analysis
 * over them. Read-only against the dataset/strategy/execution layers —
 * the only writes anywhere in this route are the HTTP response and (as a
 * durability safeguard, spec section 26 allows skipping a new Prisma
 * table when unnecessary) a JSON file for recovery if the client
 * disconnects before this finishes.
 */
export async function GET() {
  // ── Spec section 2 — DATA INTEGRITY GATE ──
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
    return NextResponse.json({ ok: false, error: "DATASET INTEGRITY GATE FAILED — Fase 19 detenida antes de ejecutar nada.", frozen: FROZEN_DATASET, found: dataset }, { status: 409 });
  }

  const bootstrapOptionsBase = {
    iterations: FROZEN_MONTE_CARLO_CONFIG.iterations,
    seed: FROZEN_MONTE_CARLO_CONFIG.seed,
    initialEquity: FROZEN_EVALUATION_PROFILE.initialBalance,
    evaluationProfile: FROZEN_EVALUATION_PROFILE,
    ruinThresholdPct: RUIN_THRESHOLD_PCT,
    returnThresholdsPct: RETURN_THRESHOLDS_PCT,
    drawdownThresholdsPct: DRAWDOWN_THRESHOLDS_PCT,
  };

  const heaviestStress = FROZEN_STRESS_SCENARIOS.find((s) => s.id === "STRESS_FEES_50_SLIPPAGE_50")!;

  const results: unknown[] = [];

  for (const strategyId of FROZEN_STRATEGY_IDS) {
    const replayRunId = FROZEN_PHASE18_REPLAY_RUN_IDS[strategyId];
    const rows = await prisma.replayResult.findMany({ where: { replayRunId, windowLabel: { in: SEGMENT_LABELS } } });
    const rowByLabel = new Map(rows.map((r) => [r.windowLabel, r]));

    const segments: unknown[] = [];
    for (const label of SEGMENT_LABELS) {
      const row = rowByLabel.get(label);
      const trades: ReplayTradeRecord[] = row ? fromJson<ReplayTradeRecord[]>(row.trades, []) : [];
      const observedMetrics: ReplayMetrics | null = row ? fromJson<ReplayMetrics>(row.metrics, null as unknown as ReplayMetrics) : null;
      const insufficientSample = trades.length < MIN_SAMPLE_SIZE;

      if (trades.length === 0) {
        segments.push({ label, tradeCount: 0, insufficientSample: true, note: "No hay trades en este segmento — nada que resamplear." });
        continue;
      }

      const options: BootstrapOptions = { ...bootstrapOptionsBase };
      const stressResults = FROZEN_STRESS_SCENARIOS.map((scenario) => {
        const stressedTrades = scenario.id === "BASE" ? trades : applyCostStress(trades, scenario);
        const aggregate = runBootstrapMonteCarlo(stressedTrades, options);
        return { scenarioId: scenario.id, label: scenario.label, aggregate };
      });
      const baseResult = stressResults.find((s) => s.scenarioId === "BASE")!;
      const heaviestResult = stressResults.find((s) => s.scenarioId === "STRESS_FEES_50_SLIPPAGE_50")!;

      let blockBootstrap: unknown = null;
      if (trades.length >= MIN_TRADES_FOR_BLOCK_BOOTSTRAP) {
        blockBootstrap = { blockSize: FROZEN_BLOCK_SIZE, aggregate: runBlockBootstrapMonteCarlo(trades, FROZEN_BLOCK_SIZE, options) };
      }

      const outliers = computeOutlierAnalysis(trades);
      const expectancy = computeExpectancyStats(trades);
      const robustness = classifyRobustness(baseResult.aggregate, heaviestResult.aggregate, observedMetrics?.totalReturnPct ?? 0, trades.length, MIN_SAMPLE_SIZE);

      segments.push({
        label,
        tradeCount: trades.length,
        insufficientSample,
        observedReturnPct: observedMetrics?.totalReturnPct ?? null,
        observedProfitFactor: observedMetrics?.profitFactor ?? null,
        stressResults,
        blockBootstrap,
        blockBootstrapSkippedReason: blockBootstrap ? null : `n=${trades.length} < MIN_TRADES_FOR_BLOCK_BOOTSTRAP (${MIN_TRADES_FOR_BLOCK_BOOTSTRAP}) — bootstrap por bloques no es estadísticamente defendible con esta muestra.`,
        outliers,
        expectancy,
        robustness,
      });
    }

    results.push({ strategyId, replayRunId, segments });
  }

  const payload = {
    ok: true,
    datasetHash: dataset.datasetHash,
    monteCarloConfig: FROZEN_MONTE_CARLO_CONFIG,
    stressScenarios: FROZEN_STRESS_SCENARIOS,
    evaluationProfile: FROZEN_EVALUATION_PROFILE,
    results,
  };

  try {
    writeFileSync(join(tmpdir(), "phase19-robustness-result.json"), JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    /* best-effort only */
  }

  return NextResponse.json(payload);
}
