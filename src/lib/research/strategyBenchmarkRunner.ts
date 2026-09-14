import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import { executeReplay } from "@/lib/replay/executeAndPersistReplay";
import type { ReplayConfig, ReplayDataSource } from "@/lib/replay/types";
import { getStrategyById } from "@/lib/engines/strategy";
import { resolveEvaluationTemplate, type EvaluationProfileTemplate, type EvaluationProfileType } from "@/lib/evaluation/evaluationRiskEngine";
import { evaluateBenchmarkRun, type BenchmarkEvaluationProfile } from "./benchmarkEvaluation";
import { computeStrategyBenchmarkMetrics } from "./benchmarkMetrics";
import { computeBenchmarkScore } from "./benchmarkScore";
import { computeStrategyConfigHash } from "./configHash";

/**
 * Fase 11 — Strategy Research & Evaluation Benchmark orchestrator. The one
 * place that ties everything together, and deliberately thin: every trade
 * simulation is a completely normal `executeReplay()` call (spec section
 * 22 — "La API debe reutilizar HistoricalReplayEngine. No duplicar el
 * motor de replay"), run once per baseline strategy with an IDENTICAL
 * config except `strategyId` (spec section 8 — same dataset/timeframe/
 * initial balance/Risk Engine/fees/slippage/execution/position limits for
 * every strategy compared). This function only adds the Evaluation Risk
 * Engine analysis pass and the composite score on top of what
 * `executeReplay` already persisted.
 */
export interface StrategyBenchmarkRequest {
  datasetSymbol: string; // internal Asset.symbol, e.g. "BTC"
  timeframe: ReplayConfig["timeframe"];
  startDate: Date;
  endDate: Date;
  evaluationProfileType: EvaluationProfileType;
  customEvaluation?: Partial<EvaluationProfileTemplate> & { initialBalance: number };
  riskLevel: number;
  strategyIds: string[];
  /**
   * Required, never defaulted (spec section 24 — "Honest Labels": what
   * backed this run must never be implicit). The `/strategy-lab` UI always
   * sends `HISTORICAL_REAL` — this stays a real parameter (rather than a
   * hardcoded constant) purely so tests can exercise this exact runner with
   * `SYNTHETIC` data, the same way `historicalReplayEngine.test.ts` and
   * `executeAndPersistReplay.test.ts` already do, without needing a slow
   * real multi-month import in the test database.
   */
  dataSource: ReplayDataSource;
}

/**
 * Runs the benchmark to completion and returns the created run's id. Always
 * creates the `StrategyBenchmarkRun` row FIRST (status RUNNING) so a crash
 * mid-run still leaves a FAILED row with a real error message behind —
 * mirrors `executeReplay`'s own convention exactly.
 */
export async function runStrategyBenchmark(request: StrategyBenchmarkRequest): Promise<string> {
  const template = resolveEvaluationTemplate(request.evaluationProfileType, request.customEvaluation);
  const resetHourUtc = 0; // matches EvaluationAccount's own DB default — see evaluationAccountStore.ts

  const run = await prisma.strategyBenchmarkRun.create({
    data: {
      datasetSymbol: request.datasetSymbol,
      timeframe: request.timeframe,
      startDate: request.startDate,
      endDate: request.endDate,
      evaluationProfileType: request.evaluationProfileType,
      evaluationConfig: toJson(template),
      riskLevel: request.riskLevel,
      status: "RUNNING",
    },
  });

  try {
    const asset = await prisma.asset.findUnique({ where: { symbol: request.datasetSymbol } });
    if (!asset) throw new Error(`No existe ningún Asset con symbol "${request.datasetSymbol}".`);
    const assetIdBySymbol = new Map([[request.datasetSymbol, asset.id]]);

    const evaluationProfile: BenchmarkEvaluationProfile = {
      initialBalance: template.initialBalance,
      phase: "PHASE_1",
      phase1TargetPct: template.phase1TargetPct,
      phase2TargetPct: template.phase2TargetPct,
      dailySafetyPct: template.dailySafetyPct,
      dailyHardPct: template.dailyHardPct,
      totalSafetyPct: template.totalSafetyPct,
      totalHardPct: template.totalHardPct,
      baseRiskPct: template.baseRiskPct,
      minRRR: template.minRRR,
      resetHourUtc,
    };

    for (const strategyId of request.strategyIds) {
      const strategyDef = getStrategyById(strategyId);
      if (!strategyDef) throw new Error(`Estrategia desconocida: "${strategyId}".`);

      const config: ReplayConfig = {
        assetSymbols: [request.datasetSymbol],
        timeframe: request.timeframe,
        startDate: request.startDate,
        endDate: request.endDate,
        strategyId,
        aiMode: "DETERMINISTIC_AI", // spec section 25 — never variable-by-real-AI for a benchmark that must be deterministic
        dataSource: request.dataSource,
        initialCapital: template.initialBalance,
        riskLevel: request.riskLevel,
      };

      const replayRunId = await executeReplay({ config });
      const replayRun = await prisma.replayRun.findUniqueOrThrow({ where: { id: replayRunId } });
      if (replayRun.status === "FAILED") {
        throw new Error(`El replay de "${strategyId}" falló: ${replayRun.error ?? "error desconocido"}.`);
      }

      const replayResult = await prisma.replayResult.findFirstOrThrow({ where: { replayRunId, windowLabel: "FULL" } });
      const metrics = JSON.parse(replayResult.metrics) as import("@/lib/replay/types").ReplayMetrics;
      const equityCurve = JSON.parse(replayResult.equityCurve) as { t: number; equity: number }[];
      const trades = JSON.parse(replayResult.trades) as import("@/lib/replay/types").ReplayTradeRecord[];

      const evaluationResult = evaluateBenchmarkRun(equityCurve, evaluationProfile);
      const benchmarkMetrics = computeStrategyBenchmarkMetrics(metrics, trades, evaluationResult, template.initialBalance);
      const score = computeBenchmarkScore(metrics, evaluationResult.status);
      const strategyConfigHash = computeStrategyConfigHash(strategyDef.id, strategyDef.version, strategyDef.defaultParams);

      await prisma.strategyBenchmarkResult.create({
        data: {
          benchmarkRunId: run.id,
          strategyId: strategyDef.id,
          strategyName: strategyDef.name,
          strategyVersion: strategyDef.version,
          strategyConfigHash,
          replayRunId,
          metrics: toJson(benchmarkMetrics),
          evaluationStatus: evaluationResult.status,
          score: toJson(score),
        },
      });
    }

    await prisma.strategyBenchmarkRun.update({ where: { id: run.id }, data: { status: "DONE", completedAt: new Date() } });
    return run.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.strategyBenchmarkRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    return run.id;
  }
}
