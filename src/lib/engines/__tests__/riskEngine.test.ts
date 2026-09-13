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
  const limits = resolveRiskLimits("BALANCED"); // maxExposurePct 50%, maxConcentrationPct 25%, maxOpenPositions 4

  it("passes at full requested size when there is ample headroom everywhere", () => {
    const result = checkExposureLimits({ equity: 1000, openNotional: 0, requestedNotional: 100, limits, openPositionCount: 0, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    expect(result.passed).toBe(true);
    expect(result.approvedNotional).toBe(100);
    expect(result.wasClamped).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it("CLAMPS (never blocks outright) when the requested notional alone would breach maxExposurePct but some headroom remains — Risk Level coherence fix", () => {
    // BALANCED maxExposurePct 50% -> cap €500. €400 already open, so only
    // €100 of headroom remains; a €200 request must not be blocked
    // outright — it should open at exactly the €100 that fits.
    const result = checkExposureLimits({ equity: 1000, openNotional: 400, requestedNotional: 200, limits, openPositionCount: 0, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    expect(result.passed).toBe(true);
    expect(result.wasClamped).toBe(true);
    expect(result.approvedNotional).toBeCloseTo(100, 6);
    expect(result.exposurePctAfter).toBeCloseTo(50, 6); // lands exactly on the cap, never over it
    expect(result.clampKinds).toContain("EXPOSURE");
  });

  it("rejects cleanly (approvedNotional 0) when exposure headroom is already fully exhausted", () => {
    const result = checkExposureLimits({ equity: 1000, openNotional: 500, requestedNotional: 100, limits, openPositionCount: 0, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    expect(result.passed).toBe(false);
    expect(result.approvedNotional).toBe(0);
    expect(result.violationKinds).toContain("EXPOSURE");
  });

  it("fails when opening would exceed max open positions, regardless of how much notional/exposure headroom exists — position count is never clampable", () => {
    const result = checkExposureLimits({ equity: 100000, openNotional: 0, requestedNotional: 1, limits, openPositionCount: limits.maxOpenPositions, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    expect(result.passed).toBe(false);
    expect(result.approvedNotional).toBe(0);
    expect(result.violationKinds).toEqual(["POSITION_SIZE"]);
  });

  it("CLAMPS to the remaining per-asset concentration headroom rather than blocking the whole trade (Fase 1.A4 + coherence fix)", () => {
    // BALANCED maxConcentrationPct 25% -> cap €250 on this one asset. €150
    // of it is already committed (well under the €500 exposure cap given
    // €400 total open), so only €100 of concentration headroom remains.
    const result = checkExposureLimits({
      equity: 1000,
      openNotional: 400,
      requestedNotional: 150,
      limits,
      openPositionCount: 2,
      assetOpenNotional: 150,
      correlatedOpenNotional: 0,
    });
    expect(result.passed).toBe(true);
    expect(result.wasClamped).toBe(true);
    expect(result.approvedNotional).toBeCloseTo(100, 6);
    expect(result.clampKinds).toContain("CONCENTRATION");
  });

  it("rejects cleanly when a single asset's existing notional already saturates maxConcentrationPct, even if TOTAL exposure is fine (Fase 1.A4)", () => {
    const result = checkExposureLimits({
      equity: 1000,
      openNotional: 400,
      requestedNotional: 100,
      limits,
      openPositionCount: 2,
      assetOpenNotional: 400, // already over the €250 per-asset cap on its own
      correlatedOpenNotional: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.approvedNotional).toBe(0);
    expect(result.violationKinds).toContain("CONCENTRATION");
  });

  it("passes at full size when the same total exposure is spread across different assets", () => {
    const result = checkExposureLimits({
      equity: 1000,
      openNotional: 400,
      requestedNotional: 100,
      limits,
      openPositionCount: 2,
      assetOpenNotional: 0, // this candidate's asset has nothing open yet
      correlatedOpenNotional: 0,
    });
    expect(result.passed).toBe(true);
    expect(result.wasClamped).toBe(false);
    expect(result.approvedNotional).toBe(100);
  });

  it("CLAMPS when notional in OTHER highly-correlated assets leaves only partial headroom under maxConcentrationPct (Fase 5)", () => {
    // BALANCED maxConcentrationPct 25% -> cap €250 shared with the
    // correlated cluster. €200 already sits there, leaving €50 headroom
    // for this €100 request.
    const result = checkExposureLimits({
      equity: 1000,
      openNotional: 300,
      requestedNotional: 100,
      limits,
      openPositionCount: 1,
      assetOpenNotional: 0,
      correlatedOpenNotional: 200,
    });
    expect(result.passed).toBe(true);
    expect(result.wasClamped).toBe(true);
    expect(result.approvedNotional).toBeCloseTo(50, 6);
    expect(result.clampKinds).toContain("CORRELATION");
  });

  it("rejects cleanly when correlated-asset notional already saturates maxConcentrationPct on its own (Fase 5)", () => {
    const result = checkExposureLimits({
      equity: 1000,
      openNotional: 300,
      requestedNotional: 100,
      limits,
      openPositionCount: 1,
      assetOpenNotional: 0,
      correlatedOpenNotional: 300, // already over the €250 cap by itself
    });
    expect(result.passed).toBe(false);
    expect(result.approvedNotional).toBe(0);
    expect(result.violationKinds).toContain("CORRELATION");
    expect(result.violations.some((v) => v.toLowerCase().includes("correlacionad"))).toBe(true);
  });

  it("does not flag correlation risk when no other open position is correlated with this candidate", () => {
    const result = checkExposureLimits({
      equity: 1000,
      openNotional: 300,
      requestedNotional: 100,
      limits,
      openPositionCount: 1,
      assetOpenNotional: 0,
      correlatedOpenNotional: 0, // nothing else is correlated with this candidate's asset
    });
    expect(result.passed).toBe(true);
    expect(result.wasClamped).toBe(false);
  });

  it("never approves more notional than requested, even with unlimited headroom", () => {
    const result = checkExposureLimits({ equity: 1_000_000, openNotional: 0, requestedNotional: 50, limits, openPositionCount: 0, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    expect(result.approvedNotional).toBe(50);
  });

  it("rejects cleanly (never forces a trade) when requestedNotional is zero or equity is zero", () => {
    const zeroRequest = checkExposureLimits({ equity: 1000, openNotional: 0, requestedNotional: 0, limits, openPositionCount: 0, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    expect(zeroRequest.passed).toBe(false);
    expect(zeroRequest.approvedNotional).toBe(0);

    const zeroEquity = checkExposureLimits({ equity: 0, openNotional: 0, requestedNotional: 100, limits, openPositionCount: 0, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    expect(zeroEquity.passed).toBe(false);
    expect(zeroEquity.approvedNotional).toBe(0);
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
