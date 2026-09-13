import { describe, expect, it } from "vitest";
import { calculatePositionSize, checkExposureLimits, resolveRiskLimitsForLevel } from "../riskEngine";

// AUDIT: Risk Level 1-10 coherence (requested follow-up to Fase 7-8's
// documented finding: "los stops por defecto de las 7 estrategias (2-4%)
// chocan con maxConcentrationPct en casi todos los niveles de riesgo").
//
// Root cause recap: `riskPerTradePct` grows ~10x from level 1 to 10 (0.3 ->
// 3.0) while `maxConcentrationPct` only grows ~4.5x (10 -> 45), so a fixed,
// tight stop (2-4%, every built-in strategy's default) produced a
// risk-based notional that outgrew the concentration cap at nearly every
// level above 1 — and the OLD `checkExposureLimits` blocked the WHOLE
// trade outright on any breach, so raising the Risk Level made a trade
// MORE likely to be rejected, not bigger. The fix makes exposure/
// concentration/correlation a CEILING that clamps the requested notional
// down to whatever headroom remains, never an all-or-nothing gate.
//
// These tests treat `calculatePositionSize` + `checkExposureLimits`
// together, exactly as every real call site (paperTradingEngine.ts,
// historicalReplayEngine.ts) uses them: sizing computes the ideal,
// risk-based notional; the exposure check turns it into what actually
// gets approved.

const EQUITY = 10000;
const ENTRY_PRICE = 100;

function sizeAtLevel(level: number, stopLossPct: number) {
  const limits = resolveRiskLimitsForLevel(level);
  const stopLossPrice = ENTRY_PRICE * (1 - stopLossPct / 100);
  const sizing = calculatePositionSize({ equity: EQUITY, entryPrice: ENTRY_PRICE, stopLossPrice, riskPerTradePct: limits.riskPerTradePct });
  const check = checkExposureLimits({
    equity: EQUITY,
    openNotional: 0,
    requestedNotional: sizing.notional,
    limits,
    openPositionCount: 0,
    assetOpenNotional: 0,
    correlatedOpenNotional: 0,
  });
  return { limits, sizing, check };
}

// The tightest defaultStopLossPct among the 7 built-in strategies
// (breakout / mean-reversion = 2%) — the scenario the audit's finding was
// actually about: a strategy whose stop is so tight that its risk-based
// notional would, pre-fix, overshoot the concentration cap at nearly every
// level above 1.
const TIGHT_STOP_PCT = 2;

describe("AUDIT: Risk Level 1-10 sizing coherence (audit follow-up)", () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("Level %i: a fresh, single-asset candidate is APPROVED (never blocked outright) with a real, positive size", (level) => {
    const { check } = sizeAtLevel(level, TIGHT_STOP_PCT);
    // A first trade on a fresh account, alone, at ANY risk level 1-10,
    // must always be approvable at SOME nonzero size — there is always
    // full headroom (nothing else is open yet), so a hard reject here
    // would mean the Risk Level dial itself is broken for its most basic
    // case.
    expect(check.passed).toBe(true);
    expect(check.approvedNotional).toBeGreaterThan(0);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("Level %i: the approved size never exceeds what was requested (Risk Engine only ever reduces, never grants more)", (level) => {
    const { sizing, check } = sizeAtLevel(level, TIGHT_STOP_PCT);
    expect(check.approvedNotional).toBeLessThanOrEqual(sizing.notional + 1e-9);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("Level %i: maxConcentrationPct is respected by the APPROVED size, even when the tight-stop risk-based request would have overshot it", (level) => {
    const { limits, check } = sizeAtLevel(level, TIGHT_STOP_PCT);
    const concentrationPctAfter = (check.approvedNotional / EQUITY) * 100;
    expect(concentrationPctAfter).toBeLessThanOrEqual(limits.maxConcentrationPct + 1e-6);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("Level %i: maxExposurePct is respected by the APPROVED size", (level) => {
    const { limits, check } = sizeAtLevel(level, TIGHT_STOP_PCT);
    expect(check.exposurePctAfter).toBeLessThanOrEqual(limits.maxExposurePct + 1e-6);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("Level %i: the realized monetary risk (approved notional × stop distance) never exceeds the CONFIGURED risk-per-trade target", (level) => {
    const { limits, check } = sizeAtLevel(level, TIGHT_STOP_PCT);
    const configuredRiskAmount = EQUITY * (limits.riskPerTradePct / 100);
    const realizedRiskAmount = check.approvedNotional * (TIGHT_STOP_PCT / 100);
    // Clamping can only ever REDUCE realized risk below the configured
    // target (when concentration/exposure binds before the full risk-based
    // size is reached) — it must never silently exceed it.
    expect(realizedRiskAmount).toBeLessThanOrEqual(configuredRiskAmount + 1e-6);
  });

  it("no level accidentally allows MORE risk than configured: realized risk as a % of equity never exceeds riskPerTradePct at any of the 10 levels", () => {
    for (let level = 1; level <= 10; level++) {
      const { limits, check } = sizeAtLevel(level, TIGHT_STOP_PCT);
      const realizedRiskPct = (check.approvedNotional * (TIGHT_STOP_PCT / 100) / EQUITY) * 100;
      expect(realizedRiskPct).toBeLessThanOrEqual(limits.riskPerTradePct + 1e-6);
    }
  });

  it("the effective approved size is monotonically non-decreasing from Level 1 to Level 10 for the SAME tight-stop strategy — the dial has real, coherent effect again", () => {
    const approved = Array.from({ length: 10 }, (_, i) => sizeAtLevel(i + 1, TIGHT_STOP_PCT).check.approvedNotional);
    for (let i = 1; i < approved.length; i++) {
      expect(approved[i]).toBeGreaterThanOrEqual(approved[i - 1] - 1e-9);
    }
  });

  it("Risk Level 1 is effectively more conservative than Risk Level 10: strictly smaller approved size for the identical candidate", () => {
    const level1 = sizeAtLevel(1, TIGHT_STOP_PCT);
    const level10 = sizeAtLevel(10, TIGHT_STOP_PCT);
    expect(level1.check.approvedNotional).toBeLessThan(level10.check.approvedNotional);
    // And strictly smaller realized monetary risk, not just a smaller
    // headline notional.
    const level1Risk = level1.check.approvedNotional * (TIGHT_STOP_PCT / 100);
    const level10Risk = level10.check.approvedNotional * (TIGHT_STOP_PCT / 100);
    expect(level1Risk).toBeLessThan(level10Risk);
  });

  it("a wider stop correctly reduces the resulting position size versus a tighter stop, at a fixed Risk Level with ample headroom", () => {
    // Level 6 (BALANCED): riskPerTradePct 1%, maxConcentrationPct 25%.
    // 1/2=50% and 1/6=16.7% both need checking against 25% — the tight one
    // clamps, so pick two stops that BOTH stay comfortably under the cap
    // to isolate the sizing formula's own direction, not the clamp.
    const narrowStop = sizeAtLevel(6, 6); // 1/6 = 16.7% < 25% cap, unclamped
    const wideStop = sizeAtLevel(6, 10); // 1/10 = 10% < 25% cap, unclamped
    expect(narrowStop.check.wasClamped).toBe(false);
    expect(wideStop.check.wasClamped).toBe(false);
    expect(wideStop.sizing.quantity).toBeLessThan(narrowStop.sizing.quantity);
    expect(wideStop.check.approvedNotional).toBeLessThan(narrowStop.check.approvedNotional);
  });

  it("a closer (tighter) stop can NEVER push the approved concentration above the limit, no matter how extreme", () => {
    const EXTREME_TIGHT_STOP_PCT = 0.05; // an almost-zero stop distance -> an enormous raw risk-based notional
    for (let level = 1; level <= 10; level++) {
      const { limits, check } = sizeAtLevel(level, EXTREME_TIGHT_STOP_PCT);
      const concentrationPctAfter = (check.approvedNotional / EQUITY) * 100;
      expect(concentrationPctAfter).toBeLessThanOrEqual(limits.maxConcentrationPct + 1e-6);
      expect(check.wasClamped).toBe(true); // this extreme case must actually exercise the clamp, not pass by accident
    }
  });

  it("an impossible-to-fit position (zero headroom left) is rejected cleanly at every Risk Level, never forced", () => {
    for (let level = 1; level <= 10; level++) {
      const limits = resolveRiskLimitsForLevel(level);
      const stopLossPrice = ENTRY_PRICE * (1 - TIGHT_STOP_PCT / 100);
      const sizing = calculatePositionSize({ equity: EQUITY, entryPrice: ENTRY_PRICE, stopLossPrice, riskPerTradePct: limits.riskPerTradePct });
      // This asset already sits exactly AT the concentration cap — zero headroom.
      const assetOpenNotional = (limits.maxConcentrationPct / 100) * EQUITY;
      const check = checkExposureLimits({
        equity: EQUITY,
        openNotional: assetOpenNotional,
        requestedNotional: sizing.notional,
        limits,
        openPositionCount: 0,
        assetOpenNotional,
        correlatedOpenNotional: 0,
      });
      expect(check.passed).toBe(false);
      expect(check.approvedNotional).toBe(0);
      expect(check.violationKinds).toContain("CONCENTRATION");
    }
  });

  it("position-count (maxOpenPositions) stays a hard, unclampable limit at every Risk Level — you cannot open a fractional position slot", () => {
    for (let level = 1; level <= 10; level++) {
      const limits = resolveRiskLimitsForLevel(level);
      const check = checkExposureLimits({
        equity: EQUITY,
        openNotional: 0,
        requestedNotional: 1, // trivially small — plenty of notional headroom
        limits,
        openPositionCount: limits.maxOpenPositions, // already at capacity
        assetOpenNotional: 0,
        correlatedOpenNotional: 0,
      });
      expect(check.passed).toBe(false);
      expect(check.approvedNotional).toBe(0);
      expect(check.violationKinds).toEqual(["POSITION_SIZE"]);
    }
  });
});
