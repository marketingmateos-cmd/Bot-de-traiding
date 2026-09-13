import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import { executeReplay } from "../executeAndPersistReplay";
import type { ReplayConfig } from "../types";

const createdRunIds: string[] = [];

function baseConfig(overrides: Partial<ReplayConfig> = {}): ReplayConfig {
  return {
    assetSymbols: ["BNB"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-02-01T00:00:00.000Z"),
    strategyId: "trend-following",
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10000,
    riskLevel: 6,
    ...overrides,
  };
}

afterAll(async () => {
  await prisma.replayResult.deleteMany({ where: { replayRunId: { in: createdRunIds } } });
  await prisma.replayRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await prisma.$disconnect();
});

describe("AUDIT: executeReplay persists a full run end to end (Fase 7/8 orchestration)", () => {
  it("runs an unsegmented replay and persists ONE 'FULL' ReplayResult with real metrics", async () => {
    const runId = await executeReplay({ config: baseConfig() });
    createdRunIds.push(runId);

    const run = await prisma.replayRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
    expect(run.status).toBe("DONE");
    expect(run.results).toHaveLength(1);
    expect(run.results[0].windowLabel).toBe("FULL");
    expect(fromJson(run.dataQualityReport, null)).not.toBeNull();
    expect(fromJson(run.robustness, null)).not.toBeNull();
    expect(fromJson(run.overfitting, null)).not.toBeNull();
    expect(fromJson(run.evidence, null)).not.toBeNull();
  });

  it("runs a segmented (IS/VALIDATION/OOS) replay and persists exactly three separate ReplayResults", async () => {
    const runId = await executeReplay({
      config: baseConfig(),
      segments: {
        is: { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-02-01T00:00:00.000Z") },
        validation: { start: new Date("2024-02-01T01:00:00.000Z"), end: new Date("2024-02-15T00:00:00.000Z") },
        oos: { start: new Date("2024-02-15T01:00:00.000Z"), end: new Date("2024-03-01T00:00:00.000Z") },
      },
    });
    createdRunIds.push(runId);

    const run = await prisma.replayRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
    expect(run.status).toBe("DONE");
    expect(run.hasSegments).toBe(true);
    const labels = run.results.map((r) => r.windowLabel).sort();
    expect(labels).toEqual(["IS", "OOS", "VALIDATION"]);

    const evidence = fromJson<{ verdict: string } | null>(run.evidence, null);
    expect(evidence).not.toBeNull();
    expect(["INSUFFICIENT_EVIDENCE", "LOW", "MEDIUM", "HIGH"]).toContain(evidence!.verdict);
  });

  it("marks the run FAILED (never silently lost) when HISTORICAL_REAL data is requested and is unavailable", async () => {
    const runId = await executeReplay({ config: baseConfig({ dataSource: "HISTORICAL_REAL" }) });
    createdRunIds.push(runId);

    const run = await prisma.replayRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("HISTORICAL DATA UNAVAILABLE");
  });
});
