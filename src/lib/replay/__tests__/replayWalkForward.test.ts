import { describe, expect, it } from "vitest";
import { runReplayWalkForward } from "../replayWalkForward";
import { computeRobustnessScore } from "@/lib/engines/robustness";
import { detectOverfitting } from "@/lib/engines/overfitting";
import { getStrategyById } from "@/lib/engines/strategy";
import type { ReplayConfig } from "../types";

function baseConfig(): ReplayConfig {
  return {
    assetSymbols: ["SOL"],
    timeframe: "H1",
    startDate: new Date(0),
    endDate: new Date(0),
    strategyId: "trend-following",
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10000,
    riskLevel: 6,
  };
}

describe("AUDIT: Walk-Forward over the full-pipeline replay engine (Fase 7E)", () => {
  it("produces multiple sliding windows, each with independent train/test metrics", async () => {
    const { walkForward, dataQuality } = await runReplayWalkForward(
      baseConfig(),
      { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-04-01T00:00:00.000Z") },
      { windowSizeDays: 30, trainFraction: 0.7, stepDays: 30 },
      new Map()
    );

    expect(dataQuality.blocksReplay).toBe(false);
    expect(walkForward.windows.length).toBeGreaterThan(0);
    for (const w of walkForward.windows) {
      expect(new Date(w.trainRange[1]).getTime()).toBeGreaterThan(new Date(w.trainRange[0]).getTime());
      expect(new Date(w.oosRange[0]).getTime()).toBe(new Date(w.trainRange[1]).getTime());
      expect(typeof w.degraded).toBe("boolean");
    }
    expect(walkForward.aggregateOosMetrics.winRateOfWindows).toBeGreaterThanOrEqual(0);
    expect(walkForward.aggregateOosMetrics.winRateOfWindows).toBeLessThanOrEqual(1);
  });

  it("feeds directly into the existing (unmodified) robustness and overfitting engines with no adapter", async () => {
    const { walkForward } = await runReplayWalkForward(
      baseConfig(),
      { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-04-01T00:00:00.000Z") },
      { windowSizeDays: 30, trainFraction: 0.7, stepDays: 30 },
      new Map()
    );

    const baseMetrics = walkForward.windows[0]?.trainMetrics;
    expect(baseMetrics).toBeDefined();

    const robustness = computeRobustnessScore({
      baseMetrics: baseMetrics!,
      walkForward,
      parameterPerturbationReturns: [],
      crossAssetReturns: [],
      costSensitivityReturns: [],
    });
    expect(robustness.score).toBeGreaterThanOrEqual(0);
    expect(robustness.score).toBeLessThanOrEqual(100);

    const strategy = getStrategyById("trend-following")!;
    const overfitting = detectOverfitting(strategy.defaultParams, baseMetrics!, walkForward);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(overfitting.risk);
  });
});
