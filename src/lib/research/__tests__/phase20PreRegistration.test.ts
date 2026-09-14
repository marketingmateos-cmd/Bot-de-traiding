import { describe, expect, it } from "vitest";
import {
  FROZEN_DATASET,
  FROZEN_RANGES,
  FROZEN_HYPOTHESIS_IDS,
  F20A_LAGS_HOURS,
  F20A_BOOTSTRAP_CONFIG,
  F20B_PARAMS,
  F20C_PARAMS,
  F20D_SESSIONS,
  F20D_MIN_EVIDENCE_LEVEL,
  F20D_FORMALIZE_AS_STRATEGY,
  F20E_PARAMS,
  MIN_SAMPLE_SIZE,
  FROZEN_RISK_LEVEL,
  FROZEN_INITIAL_CAPITAL,
  EDGE_COMPARISON_THRESHOLDS,
  FROZEN_WALK_FORWARD_OPTIONS,
  FROZEN_MONTE_CARLO_CONFIG,
  FROZEN_PHASE18_REPLAY_RUN_IDS,
  SEGMENT_LABELS,
} from "../phase20PreRegistration";

describe("Fase 20 pre-registration — frozen manifest", () => {
  it("freezes exactly the 5 approved hypothesis families, never more, never fewer", () => {
    expect(FROZEN_HYPOTHESIS_IDS).toEqual(["f20-a-return-autocorrelation", "f20-b-volatility-transition-shock", "f20-c-volume-price-divergence", "f20-d-session-effect", "f20-e-compression-duration"]);
    expect(FROZEN_HYPOTHESIS_IDS).toHaveLength(5);
  });

  it("reuses the exact same dataset hash and IS/VALIDATION/OOS ranges as Fase 18, never redefining them", () => {
    expect(FROZEN_DATASET.datasetHash).toBe("8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503");
    expect(FROZEN_RANGES.is.start.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(FROZEN_RANGES.oos.end.toISOString()).toBe("2026-08-31T23:00:00.000Z");
  });

  it("F20-A freezes exactly the 6 mandated lags and a deterministic bootstrap config", () => {
    expect(F20A_LAGS_HOURS).toEqual([1, 2, 3, 6, 12, 24]);
    expect(Number.isInteger(F20A_BOOTSTRAP_CONFIG.seed)).toBe(true);
    expect(F20A_BOOTSTRAP_CONFIG.iterations).toBeGreaterThan(0);
  });

  it("F20-B/C/E freeze non-empty, fully-specified parameter sets", () => {
    expect(F20B_PARAMS).toEqual({ transitionWindowBars: 3, volatilityPeriod: 14, rrr: 1.5 });
    expect(F20C_PARAMS).toEqual({ lookback: 20, volatilityPeriod: 14, volumeRatioThreshold: 0.7, rrr: 1.5 });
    expect(F20E_PARAMS).toEqual({ atrPeriod: 14, squeezeLookback: 40, squeezePercentile: 20, rangeLookback: 10, expansionMultiplier: 1.3, minCoilLength: 10, rrr: 1.5 });
  });

  it("F20-E reuses F17-A's exact squeezeLookback/squeezePercentile (never re-chosen), only adding minCoilLength as its genuinely new parameter", () => {
    expect(F20E_PARAMS.squeezeLookback).toBe(40);
    expect(F20E_PARAMS.squeezePercentile).toBe(20);
  });

  it("F20-D freezes exactly 3 fixed sessions (never 24 individual hours) and a strict evidence bar", () => {
    expect(F20D_SESSIONS.map((s) => s.name)).toEqual(["ASIA", "LONDON", "NY"]);
    expect(F20D_SESSIONS).toHaveLength(3);
    expect(F20D_MIN_EVIDENCE_LEVEL).toBe("SUPPORTED");
    expect(F20D_FORMALIZE_AS_STRATEGY).toBe(false);
  });

  it("freezes the same risk profile as Fase 11/17/18/19", () => {
    expect(FROZEN_RISK_LEVEL).toBe(5);
    expect(FROZEN_INITIAL_CAPITAL).toBe(20000);
    expect(MIN_SAMPLE_SIZE).toBe(20);
  });

  it("freezes the edge-comparison thresholds with the 'high' bound strictly above the 'low' bound for both signals", () => {
    expect(EDGE_COMPARISON_THRESHOLDS.correlationHigh).toBeGreaterThan(EDGE_COMPARISON_THRESHOLDS.correlationLow);
    expect(EDGE_COMPARISON_THRESHOLDS.temporalOverlapHigh).toBeGreaterThan(EDGE_COMPARISON_THRESHOLDS.temporalOverlapLow);
  });

  it("reuses Fase 18's exact same supplementary walk-forward config, never redefining it", () => {
    expect(FROZEN_WALK_FORWARD_OPTIONS).toEqual({ windowSizeDays: 90, trainFraction: 0.7, stepDays: 45 });
  });

  it("freezes a Monte Carlo config with a deterministic seed distinct from Fase 19's own", () => {
    expect(Number.isInteger(FROZEN_MONTE_CARLO_CONFIG.seed)).toBe(true);
    expect(FROZEN_MONTE_CARLO_CONFIG.iterations).toBeGreaterThan(0);
    expect(FROZEN_MONTE_CARLO_CONFIG.seed).not.toBe(19);
  });

  it("reuses the exact 9 Fase 18 replayRunIds (F20-D reads their already-persisted trades, never re-executes them)", () => {
    expect(Object.keys(FROZEN_PHASE18_REPLAY_RUN_IDS)).toHaveLength(9);
    expect(SEGMENT_LABELS).toEqual(["IS", "VALIDATION", "OOS"]);
  });
});
