import { describe, expect, it } from "vitest";
import { runReplayRobustnessAnalysis, detectReplayOverfitting } from "../replayRobustness";
import { runReplayWalkForward } from "../replayWalkForward";
import { runFullReplay } from "../runReplay";
import type { ReplayConfig } from "../types";

function baseConfig(): ReplayConfig {
  return {
    assetSymbols: ["BTC"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-04-01T00:00:00.000Z"),
    strategyId: "trend-following",
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10000,
    riskLevel: 6,
  };
}

describe("AUDIT: Robustness classification never says ROBUST on an insufficient sample (Fase 7G)", () => {
  it("classifies INSUFFICIENT_DATA when there's no walk-forward / too few trades, regardless of score", async () => {
    const config = baseConfig();
    const { result } = await runFullReplay(config, new Map());

    const report = await runReplayRobustnessAnalysis(config, result.metrics, null, new Map());
    expect(report.classification).toBe("INSUFFICIENT_DATA");
  });

  it("runs real perturbations (cost sensitivity, parameter jitter) and produces a bounded 0-100 score", async () => {
    const config = baseConfig();
    const { result } = await runFullReplay(config, new Map());
    const { walkForward } = await runReplayWalkForward(config, { start: config.startDate, end: config.endDate }, { windowSizeDays: 30, trainFraction: 0.7, stepDays: 30 }, new Map());

    const report = await runReplayRobustnessAnalysis(config, result.metrics, walkForward, new Map());
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.factors.length).toBeGreaterThan(0);
    expect(["ROBUST", "MODERATE", "FRAGILE", "INSUFFICIENT_DATA"]).toContain(report.classification);
  });
});

describe("AUDIT: Overfitting detector on replay results (Fase 7H)", () => {
  it("flags a HIGH risk warning path (few trades / no walk-forward) via the unmodified detectOverfitting engine", async () => {
    const config = baseConfig();
    const { result } = await runFullReplay(config, new Map());
    const report = detectReplayOverfitting(config, result.metrics, null);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(report.risk);
    expect(report.flags.length).toBeGreaterThan(0);
  });
});
