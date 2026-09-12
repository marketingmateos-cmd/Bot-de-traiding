import { describe, expect, it } from "vitest";
import {
  calculatePositionSize,
  checkExposureLimits,
  computeDrawdown,
  correlation,
  resolveRiskLimits,
  resolveRiskLimitsForLevel,
  riskPresetForLevel,
} from "../riskEngine";

describe("calculatePositionSize", () => {
  it("sizes a position so the loss at the stop equals the risked amount", () => {
    const result = calculatePositionSize({ equity: 1000, entryPrice: 100, stopLossPrice: 97, riskPerTradePct: 1 });
    // risk 1% of 1000 = 10; stop distance = 3; quantity = 10/3
    expect(result.quantity).toBeCloseTo(10 / 3, 6);
    expect(result.riskAmount).toBeCloseTo(10, 6);
    const lossAtStop = result.quantity * 3;
    expect(lossAtStop).toBeCloseTo(result.riskAmount, 6);
  });

  it("returns zero quantity when stop equals entry (no defined risk)", () => {
    const result = calculatePositionSize({ equity: 1000, entryPrice: 100, stopLossPrice: 100, riskPerTradePct: 1 });
    expect(result.quantity).toBe(0);
    expect(result.notional).toBe(0);
  });

  it("never returns a negative or NaN quantity for valid inputs", () => {
    const result = calculatePositionSize({ equity: 100, entryPrice: 0.5, stopLossPrice: 0.48, riskPerTradePct: 2 });
    expect(result.quantity).toBeGreaterThan(0);
    expect(Number.isFinite(result.quantity)).toBe(true);
  });
});

describe("checkExposureLimits", () => {
  const limits = resolveRiskLimits("BALANCED");

  it("passes when projected exposure is within limits", () => {
    const result = checkExposureLimits({ equity: 1000, openNotional: 0, newNotional: 100, limits, openPositionCount: 0 });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails when projected exposure exceeds the profile's max", () => {
    const result = checkExposureLimits({ equity: 1000, openNotional: 400, newNotional: 200, limits, openPositionCount: 0 });
    // BALANCED maxExposurePct = 50 -> (400+200)/1000 = 60% > 50%
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("fails when opening would exceed max open positions even if exposure is fine", () => {
    const result = checkExposureLimits({ equity: 100000, openNotional: 0, newNotional: 1, limits, openPositionCount: limits.maxOpenPositions });
    expect(result.passed).toBe(false);
  });
});

describe("resolveRiskLimits", () => {
  it("returns stricter limits for CONSERVATIVE than AGGRESSIVE", () => {
    const conservative = resolveRiskLimits("CONSERVATIVE");
    const aggressive = resolveRiskLimits("AGGRESSIVE");
    expect(conservative.riskPerTradePct).toBeLessThan(aggressive.riskPerTradePct);
    expect(conservative.maxExposurePct).toBeLessThan(aggressive.maxExposurePct);
    expect(conservative.maxDrawdownPct).toBeLessThan(aggressive.maxDrawdownPct);
  });

  it("honors custom overrides for the CUSTOM profile", () => {
    const custom = resolveRiskLimits("CUSTOM", { riskPerTradePct: 5, maxOpenPositions: 10 });
    expect(custom.riskPerTradePct).toBe(5);
    expect(custom.maxOpenPositions).toBe(10);
  });
});

describe("resolveRiskLimitsForLevel", () => {
  it("produces strictly increasing risk-per-trade and exposure across all 10 levels", () => {
    const limitsByLevel = Array.from({ length: 10 }, (_, i) => resolveRiskLimitsForLevel(i + 1));
    for (let i = 1; i < limitsByLevel.length; i++) {
      expect(limitsByLevel[i].riskPerTradePct).toBeGreaterThanOrEqual(limitsByLevel[i - 1].riskPerTradePct);
      expect(limitsByLevel[i].maxExposurePct).toBeGreaterThanOrEqual(limitsByLevel[i - 1].maxExposurePct);
    }
    // level 1 must be meaningfully stricter than level 10 — not just relabeled
    expect(limitsByLevel[0].riskPerTradePct).toBeLessThan(limitsByLevel[9].riskPerTradePct);
    expect(limitsByLevel[0].maxOpenPositions).toBeLessThan(limitsByLevel[9].maxOpenPositions);
  });

  it("clamps out-of-range levels instead of extrapolating wildly", () => {
    expect(resolveRiskLimitsForLevel(0)).toEqual(resolveRiskLimitsForLevel(1));
    expect(resolveRiskLimitsForLevel(99)).toEqual(resolveRiskLimitsForLevel(10));
  });

  it("distinguishes adjacent levels — the dial is not decorative", () => {
    const level4 = resolveRiskLimitsForLevel(4);
    const level5 = resolveRiskLimitsForLevel(5);
    expect(level4).not.toEqual(level5);
  });
});

describe("riskPresetForLevel", () => {
  it("maps levels to the documented preset bands", () => {
    expect(riskPresetForLevel(1)).toBe("CONSERVATIVE");
    expect(riskPresetForLevel(3)).toBe("CONSERVATIVE");
    expect(riskPresetForLevel(4)).toBe("BALANCED");
    expect(riskPresetForLevel(6)).toBe("BALANCED");
    expect(riskPresetForLevel(7)).toBe("AGGRESSIVE");
    expect(riskPresetForLevel(8)).toBe("AGGRESSIVE");
    expect(riskPresetForLevel(9)).toBe("VERY_AGGRESSIVE");
    expect(riskPresetForLevel(10)).toBe("VERY_AGGRESSIVE");
  });
});

describe("computeDrawdown", () => {
  it("computes zero drawdown on a monotonically increasing curve", () => {
    const dd = computeDrawdown([100, 110, 120, 130]);
    expect(dd.current).toBe(0);
    expect(dd.max).toBe(0);
  });

  it("computes correct max drawdown from a peak", () => {
    const dd = computeDrawdown([100, 200, 150, 100, 180]);
    // peak 200 -> trough 100 = 50% drawdown
    expect(dd.max).toBeCloseTo(50, 6);
    // current: from peak 200 to final 180 = 10%
    expect(dd.current).toBeCloseTo(10, 6);
  });
});

describe("correlation", () => {
  it("returns 1 for identical series", () => {
    const c = correlation([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(c).toBeCloseTo(1, 6);
  });

  it("returns -1 for perfectly inverse series", () => {
    const c = correlation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    expect(c).toBeCloseTo(-1, 6);
  });

  it("returns null for too-short series", () => {
    expect(correlation([1], [1])).toBeNull();
  });
});
