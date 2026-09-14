import { describe, expect, it } from "vitest";
import {
  FROZEN_DATASET,
  FROZEN_MONTE_CARLO_CONFIG,
  FROZEN_STRESS_SCENARIOS,
  FROZEN_EVALUATION_PROFILE,
  FROZEN_RISK_LEVEL,
  FROZEN_PHASE18_REPLAY_RUN_IDS,
  FROZEN_STRATEGY_IDS,
  MIN_SAMPLE_SIZE,
  MIN_TRADES_FOR_BLOCK_BOOTSTRAP,
  FROZEN_BLOCK_SIZE,
} from "../phase19PreRegistration";

describe("Fase 19 pre-registration — frozen configuration", () => {
  it("freezes the exact same dataset hash as Fase 16/18", () => {
    expect(FROZEN_DATASET.datasetHash).toBe("8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503");
    expect(FROZEN_DATASET.rowCount).toBe(4416);
  });

  it("freezes a deterministic seed and at least 10,000 iterations", () => {
    expect(Number.isInteger(FROZEN_MONTE_CARLO_CONFIG.seed)).toBe(true);
    expect(FROZEN_MONTE_CARLO_CONFIG.iterations).toBeGreaterThanOrEqual(10_000);
  });

  it("freezes exactly the 6 spec-mandated stress scenarios (BASE + 5), in order, with BASE as a true no-op", () => {
    expect(FROZEN_STRESS_SCENARIOS.map((s) => s.id)).toEqual(["BASE", "STRESS_FEES_25", "STRESS_FEES_50", "STRESS_SLIPPAGE_25", "STRESS_SLIPPAGE_50", "STRESS_FEES_50_SLIPPAGE_50"]);
    expect(FROZEN_STRESS_SCENARIOS[0]).toMatchObject({ feeMultiplier: 1, slippageMultiplier: 1 });
  });

  it("freezes the exact same €20K / Risk Level 5 evaluation profile as Fase 11/17/18", () => {
    expect(FROZEN_EVALUATION_PROFILE.initialBalance).toBe(20000);
    expect(FROZEN_EVALUATION_PROFILE.phase1TargetPct).toBe(10);
    expect(FROZEN_EVALUATION_PROFILE.dailyHardPct).toBe(-5);
    expect(FROZEN_EVALUATION_PROFILE.totalHardPct).toBe(-10);
    expect(FROZEN_RISK_LEVEL).toBe(5);
  });

  it("freezes the exact 9 strategy -> Fase 18 replayRunId mapping, never re-executing a strategy", () => {
    expect(FROZEN_STRATEGY_IDS).toHaveLength(9);
    for (const id of FROZEN_STRATEGY_IDS) {
      expect(FROZEN_PHASE18_REPLAY_RUN_IDS[id]).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("freezes the sample-size floor and block-bootstrap thresholds", () => {
    expect(MIN_SAMPLE_SIZE).toBe(20);
    expect(MIN_TRADES_FOR_BLOCK_BOOTSTRAP).toBeGreaterThanOrEqual(MIN_SAMPLE_SIZE);
    expect(FROZEN_BLOCK_SIZE).toBeGreaterThan(1);
  });
});
