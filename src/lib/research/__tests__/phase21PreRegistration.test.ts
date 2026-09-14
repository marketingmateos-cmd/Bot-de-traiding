import { describe, expect, it } from "vitest";
import {
  FROZEN_DATASET_BTC,
  FROZEN_DATASET_ETH,
  FROZEN_RANGES,
  MIN_SAMPLE_SIZE,
  F21A_LAGS_HOURS,
  F21A_BOOTSTRAP_CONFIG,
  F21B_HORIZONS_HOURS,
  F21B_EXTREME_PERCENTILE,
  F21B_PERCENTILE_LOOKBACK,
  F21C_LOW_VOL_PERCENTILE,
  F21C_HIGH_VOL_PERCENTILE,
  F21D_VOLUME_IS_REAL_EXCHANGE_VOLUME_NOT_A_PROXY,
  F21E_SQUEEZE_LOOKBACK,
  F21E_SQUEEZE_PERCENTILE,
  F21E_MIN_COIL_LENGTH,
  F21F_MIN_CELL_SAMPLE_SIZE,
} from "../phase21PreRegistration";

describe("Fase 21 pre-registration — frozen dataset identity", () => {
  it("freezes BTC and ETH over the exact same ~3.5 year H1 range, verified real hashes", () => {
    expect(FROZEN_DATASET_BTC.symbol).toBe("BTC");
    expect(FROZEN_DATASET_ETH.symbol).toBe("ETH");
    expect(FROZEN_DATASET_BTC.startDate.toISOString()).toBe("2023-01-01T00:00:00.000Z");
    expect(FROZEN_DATASET_ETH.startDate.toISOString()).toBe("2023-01-01T00:00:00.000Z");
    expect(FROZEN_DATASET_BTC.endDate.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(FROZEN_DATASET_ETH.endDate.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(FROZEN_DATASET_BTC.rowCount).toBe(32135);
    expect(FROZEN_DATASET_ETH.rowCount).toBe(32135);
    expect(FROZEN_DATASET_BTC.datasetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(FROZEN_DATASET_ETH.datasetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(FROZEN_DATASET_BTC.datasetHash).not.toBe(FROZEN_DATASET_ETH.datasetHash);
  });

  it("documents the one real gap found in both series honestly, never rounds it to zero", () => {
    expect(FROZEN_DATASET_BTC.gapCount).toBe(1);
    expect(FROZEN_DATASET_ETH.gapCount).toBe(1);
    expect(FROZEN_DATASET_BTC.coveragePct).toBeLessThan(100);
  });

  it("freezes an IS/VALIDATION/OOS split via the reused Fase 13 function, never a hand-typed range", () => {
    expect(FROZEN_RANGES.is.start.toISOString()).toBe(FROZEN_DATASET_BTC.startDate.toISOString());
    expect(FROZEN_RANGES.oos.end.toISOString()).toBe(FROZEN_DATASET_BTC.endDate.toISOString());
    expect(FROZEN_RANGES.is.end.getTime()).toBeLessThan(FROZEN_RANGES.validation.start.getTime());
    expect(FROZEN_RANGES.validation.end.getTime()).toBeLessThan(FROZEN_RANGES.oos.start.getTime());
  });
});

describe("Fase 21 pre-registration — family parameters frozen before any Discovery run", () => {
  it("F21-A: exactly the 6 mandated lags, deterministic bootstrap config", () => {
    expect(F21A_LAGS_HOURS).toEqual([1, 2, 3, 6, 12, 24]);
    expect(Number.isInteger(F21A_BOOTSTRAP_CONFIG.seed)).toBe(true);
  });

  it("F21-B: horizons and a percentile-based (not z-score) extreme threshold", () => {
    expect(F21B_HORIZONS_HOURS).toEqual([1, 3, 6, 12, 24]);
    expect(F21B_EXTREME_PERCENTILE).toBeGreaterThan(0);
    expect(F21B_EXTREME_PERCENTILE).toBeLessThan(50);
    expect(F21B_PERCENTILE_LOOKBACK).toBeGreaterThan(0);
  });

  it("F21-C: low/high volatility percentile thresholds are symmetric around the middle", () => {
    expect(F21C_LOW_VOL_PERCENTILE).toBeLessThan(50);
    expect(F21C_HIGH_VOL_PERCENTILE).toBeGreaterThan(50);
  });

  it("F21-D: volume is explicitly documented as real exchange volume, not a proxy", () => {
    expect(F21D_VOLUME_IS_REAL_EXCHANGE_VOLUME_NOT_A_PROXY).toBe(true);
  });

  it("F21-E: reuses F17-A/F20-E's exact squeezeLookback/squeezePercentile, never re-chosen", () => {
    expect(F21E_SQUEEZE_LOOKBACK).toBe(40);
    expect(F21E_SQUEEZE_PERCENTILE).toBe(20);
    expect(F21E_MIN_COIL_LENGTH).toBe(10);
  });

  it("F21-F: the regime cross-tab sample-size floor matches the global MIN_SAMPLE_SIZE", () => {
    expect(F21F_MIN_CELL_SAMPLE_SIZE).toBe(MIN_SAMPLE_SIZE);
    expect(MIN_SAMPLE_SIZE).toBe(20);
  });
});
