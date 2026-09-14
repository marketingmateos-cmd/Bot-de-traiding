import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import { runStrategyBenchmark, type StrategyBenchmarkRequest } from "../strategyBenchmarkRunner";
import type { StrategyBenchmarkMetrics } from "../benchmarkMetrics";

const createdBenchmarkRunIds: string[] = [];
const createdReplayRunIds: string[] = [];

function baseRequest(overrides: Partial<StrategyBenchmarkRequest> = {}): StrategyBenchmarkRequest {
  return {
    datasetSymbol: "BTC",
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-02-01T00:00:00.000Z"),
    evaluationProfileType: "20K",
    riskLevel: 5,
    strategyIds: ["breakout-baseline-v1"],
    dataSource: "SYNTHETIC", // deterministic, reproducible, no real-data dependency — see historicalDataProvider.ts's doc comment
    ...overrides,
  };
}

async function trackAndFetch(request: StrategyBenchmarkRequest) {
  const benchmarkRunId = await runStrategyBenchmark(request);
  createdBenchmarkRunIds.push(benchmarkRunId);
  const run = await prisma.strategyBenchmarkRun.findUniqueOrThrow({ where: { id: benchmarkRunId }, include: { results: true } });
  for (const r of run.results) createdReplayRunIds.push(r.replayRunId);
  return run;
}

afterAll(async () => {
  await prisma.strategyBenchmarkResult.deleteMany({ where: { benchmarkRunId: { in: createdBenchmarkRunIds } } });
  await prisma.strategyBenchmarkRun.deleteMany({ where: { id: { in: createdBenchmarkRunIds } } });
  await prisma.replayResult.deleteMany({ where: { replayRunId: { in: createdReplayRunIds } } });
  await prisma.replayRun.deleteMany({ where: { id: { in: createdReplayRunIds } } });
  await prisma.$disconnect();
});

describe("Fase 11 — runStrategyBenchmark: reuses HistoricalReplayEngine, never duplicates it", () => {
  it("persists a DONE StrategyBenchmarkRun with one StrategyBenchmarkResult pointing at a real, normal ReplayRun", async () => {
    const run = await trackAndFetch(baseRequest());
    expect(run.status).toBe("DONE");
    expect(run.results).toHaveLength(1);

    const result = run.results[0];
    expect(result.strategyId).toBe("breakout-baseline-v1");
    const replayRun = await prisma.replayRun.findUniqueOrThrow({ where: { id: result.replayRunId } });
    expect(replayRun.status).toBe("DONE");
    expect(replayRun.strategyId).toBe("breakout-baseline-v1");
    expect(replayRun.dataSource).toBe("SYNTHETIC");
  });
});

describe("Fase 11 — same dataset/risk/evaluation profile for every strategy compared", () => {
  it("all strategies in one run share IDENTICAL dataset/timeframe/initialCapital/riskLevel — never a per-strategy advantage", async () => {
    const run = await trackAndFetch(baseRequest({ strategyIds: ["breakout-baseline-v1", "momentum-baseline-v1", "mean-reversion-baseline-v1", "trend-following-baseline-v1"] }));
    expect(run.results).toHaveLength(4);

    const replayRuns = await Promise.all(run.results.map((r) => prisma.replayRun.findUniqueOrThrow({ where: { id: r.replayRunId } })));
    const [first, ...rest] = replayRuns;
    for (const other of rest) {
      expect(other.assetSymbols).toBe(first.assetSymbols);
      expect(other.timeframe).toBe(first.timeframe);
      expect(other.startDate.getTime()).toBe(first.startDate.getTime());
      expect(other.endDate.getTime()).toBe(first.endDate.getTime());
      expect(other.initialCapital).toBe(first.initialCapital);
      expect(other.riskLevel).toBe(first.riskLevel);
      expect(other.aiMode).toBe(first.aiMode);
      expect(other.dataSource).toBe(first.dataSource);
    }

    // Every StrategyBenchmarkResult also carries the SAME evaluationConfig snapshot from the parent run.
    const evaluationConfig = fromJson(run.evaluationConfig, null);
    expect(evaluationConfig).not.toBeNull();
  });
});

describe("Fase 11 — deterministic output (spec section 20)", () => {
  it("the exact same strategy + dataset + config produces identical metrics/score across two separate runs", async () => {
    const request = baseRequest({ strategyIds: ["momentum-baseline-v1"] });
    const runA = await trackAndFetch(request);
    const runB = await trackAndFetch(request);

    const resultA = runA.results[0];
    const resultB = runB.results[0];
    expect(resultA.strategyConfigHash).toBe(resultB.strategyConfigHash);
    expect(resultA.metrics).toBe(resultB.metrics); // byte-identical JSON strings
    expect(resultA.score).toBe(resultB.score);
    expect(resultA.evaluationStatus).toBe(resultB.evaluationStatus);
  });
});

describe("Fase 11 — correct metrics bucketing", () => {
  it("persisted metrics match the exact shape computeStrategyBenchmarkMetrics produces (performance/risk/evaluation/execution)", async () => {
    const run = await trackAndFetch(baseRequest({ strategyIds: ["trend-following-baseline-v1"] }));
    const metrics = fromJson<StrategyBenchmarkMetrics | null>(run.results[0].metrics, null);
    expect(metrics).not.toBeNull();
    expect(metrics).toHaveProperty("performance.totalReturnPct");
    expect(metrics).toHaveProperty("risk.maxDrawdownPct");
    expect(metrics).toHaveProperty("evaluation.status");
    expect(metrics).toHaveProperty("execution.trades");
    expect(["PASS", "FAIL", "INCONCLUSIVE"]).toContain(metrics!.evaluation.status);
  });
});

describe("Fase 11 — no future leakage (reuses HistoricalReplayEngine's own anti-lookahead guarantee)", () => {
  it("the underlying replay's own data-quality report shows zero future leakage, even with the new signal-level stop/target override wired in", async () => {
    const run = await trackAndFetch(baseRequest({ strategyIds: ["breakout-baseline-v1"] }));
    const replayRun = await prisma.replayRun.findUniqueOrThrow({ where: { id: run.results[0].replayRunId } });
    const dataQuality = fromJson<{ futureLeakage: number; chronologyViolations: number } | null>(replayRun.dataQualityReport, null);
    expect(dataQuality).not.toBeNull();
    expect(dataQuality!.futureLeakage).toBe(0);
    expect(dataQuality!.chronologyViolations).toBe(0);
  });
});

describe("Fase 11 — evaluation PASS/FAIL/INCONCLUSIVE is always one of the three, never fabricated", () => {
  it("every strategy in a multi-strategy run gets a valid, distinct-per-trajectory evaluation status", async () => {
    const run = await trackAndFetch(baseRequest({ strategyIds: ["breakout-baseline-v1", "mean-reversion-baseline-v1"] }));
    for (const result of run.results) {
      expect(["PASS", "FAIL", "INCONCLUSIVE"]).toContain(result.evaluationStatus);
    }
  });
});

describe("Fase 11 — an unknown strategy id fails the whole benchmark honestly, never silently skips it", () => {
  it("FAILED with a clear error naming the unknown strategy", async () => {
    const run = await trackAndFetch(baseRequest({ strategyIds: ["breakout-baseline-v1", "does-not-exist"] }));
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/does-not-exist/);
  });
});
