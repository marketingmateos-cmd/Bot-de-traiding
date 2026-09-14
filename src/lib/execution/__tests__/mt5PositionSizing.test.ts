import { describe, expect, it } from "vitest";
import { calculateMt5PositionSize } from "../mt5PositionSizing";
import type { Mt5SymbolSpec } from "../types";

const EURUSD_SPEC: Mt5SymbolSpec = {
  symbol: "EURUSDm",
  tickSize: 0.00001,
  tickValue: 1, // $1 per tick move per 1.0 lot (standard 100k EURUSD lot)
  contractSize: 100000,
  volumeStep: 0.01,
  volumeMin: 0.01,
  volumeMax: 50,
  digits: 5,
};

describe("MT5 Fase 2, spec section 4 — calculateMt5PositionSize: correct risk", () => {
  it("sizes so the actual monetary risk never exceeds the requested risk amount", () => {
    const result = calculateMt5PositionSize({
      accountEquity: 20000,
      riskPct: 1, // risk $200
      entryPrice: 1.1,
      stopLoss: 1.095, // 50-pip stop = 0.005 = 500 ticks
      symbolSpec: EURUSD_SPEC,
    });
    expect(result.approved).toBe(true);
    if (result.approved) {
      // riskPerLot = (0.005 / 0.00001) * 1 = 500 * 1 = $500/lot; ideal volume = 200/500 = 0.4 lots
      expect(result.volume).toBeCloseTo(0.4, 5);
      expect(result.riskAmount).toBeLessThanOrEqual(200 + 1e-9);
      expect(result.riskAmount).toBeCloseTo(200, 5);
    }
  });
});

describe("MT5 Fase 2, spec section 4 — tickValue sensitivity", () => {
  it("a larger tickValue for the same stop distance results in a smaller volume (same monetary risk, more risk per lot)", () => {
    const cheapTick = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: { ...EURUSD_SPEC, tickValue: 1 } });
    const expensiveTick = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: { ...EURUSD_SPEC, tickValue: 10 } });
    expect(cheapTick.approved && expensiveTick.approved).toBe(true);
    if (cheapTick.approved && expensiveTick.approved) {
      expect(expensiveTick.volume).toBeLessThan(cheapTick.volume);
    }
  });
});

describe("MT5 Fase 2, spec section 4 — tickSize sensitivity", () => {
  it("a smaller tickSize (finer granularity) for the same price stop distance changes riskPerLot and thus volume", () => {
    const fineTick = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: { ...EURUSD_SPEC, tickSize: 0.00001, tickValue: 1 } });
    const coarseTick = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: { ...EURUSD_SPEC, tickSize: 0.0001, tickValue: 1 } });
    expect(fineTick.approved && coarseTick.approved).toBe(true);
    if (fineTick.approved && coarseTick.approved) {
      // Coarser tickSize -> fewer ticks in the same stop distance -> lower riskPerLot -> larger volume for the same risk budget.
      expect(coarseTick.volume).toBeGreaterThan(fineTick.volume);
    }
  });
});

describe("MT5 Fase 2, spec section 4 — volumeStep flooring (never rounds up)", () => {
  it("floors the ideal volume to the nearest volumeStep below it", () => {
    const result = calculateMt5PositionSize({
      accountEquity: 20000,
      riskPct: 1, // risk $200 -> ideal volume 0.4 at $500/lot risk, but with a 0.03 step: floor(0.4/0.03)*0.03 = 13*0.03 = 0.39
      entryPrice: 1.1,
      stopLoss: 1.095,
      symbolSpec: { ...EURUSD_SPEC, volumeStep: 0.03 },
    });
    expect(result.approved).toBe(true);
    if (result.approved) {
      expect(result.volume).toBeCloseTo(0.39, 5);
      expect(result.riskAmount).toBeLessThanOrEqual(200 + 1e-9);
    }
  });
});

describe("MT5 Fase 2, spec section 4 — minimum volume (reject rather than round up)", () => {
  it("REJECTS (BELOW_MINIMUM_VOLUME) rather than rounding up to volumeMin when the ideal size floors below it", () => {
    const result = calculateMt5PositionSize({
      accountEquity: 1000,
      riskPct: 0.1, // risk $1 — tiny, floors to 0 lots at this symbol's tick economics
      entryPrice: 1.1,
      stopLoss: 1.095,
      symbolSpec: EURUSD_SPEC,
    });
    expect(result.approved).toBe(false);
    if (!result.approved) {
      expect(result.reason).toBe("BELOW_MINIMUM_VOLUME");
    }
  });
});

describe("MT5 Fase 2, spec section 4 — maximum volume (clamp down, never exceed)", () => {
  it("clamps the volume down to volumeMax rather than exceeding it, even when the ideal risk-based size is larger", () => {
    const result = calculateMt5PositionSize({
      accountEquity: 50_000_000,
      riskPct: 5,
      entryPrice: 1.1,
      stopLoss: 1.095,
      symbolSpec: { ...EURUSD_SPEC, volumeMax: 10 },
    });
    expect(result.approved).toBe(true);
    if (result.approved) {
      expect(result.volume).toBeLessThanOrEqual(10);
    }
  });
});

describe("MT5 Fase 2, spec section 4 — invalid symbol metadata (REJECT, never guess)", () => {
  it("rejects when tickSize is zero/non-finite", () => {
    const result = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: { ...EURUSD_SPEC, tickSize: 0 } });
    expect(result.approved).toBe(false);
    if (!result.approved) expect(result.reason).toBe("INVALID_SYMBOL_METADATA");
  });

  it("rejects when contractSize is negative", () => {
    const result = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: { ...EURUSD_SPEC, contractSize: -1 } });
    expect(result.approved).toBe(false);
    if (!result.approved) expect(result.reason).toBe("INVALID_SYMBOL_METADATA");
  });

  it("rejects when volumeStep is zero", () => {
    const result = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: { ...EURUSD_SPEC, volumeStep: 0 } });
    expect(result.approved).toBe(false);
    if (!result.approved) expect(result.reason).toBe("INVALID_SYMBOL_METADATA");
  });
});

describe("MT5 Fase 2, spec section 4 — invalid stop distance", () => {
  it("rejects when stopLoss equals entryPrice (zero distance)", () => {
    const result = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.1, symbolSpec: EURUSD_SPEC });
    expect(result.approved).toBe(false);
    if (!result.approved) expect(result.reason).toBe("INVALID_STOP_DISTANCE");
  });

  it("rejects a zero-or-negative risk amount (e.g. zero equity)", () => {
    const result = calculateMt5PositionSize({ accountEquity: 0, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: EURUSD_SPEC });
    expect(result.approved).toBe(false);
    if (!result.approved) expect(result.reason).toBe("ZERO_OR_NEGATIVE_RISK_AMOUNT");
  });
});

describe("MT5 Fase 2, spec section 4 — risk never exceeds the approved (exposure-clamped) ceiling", () => {
  it("maxApprovedNotional narrows the volume further, never widening it", () => {
    const unclamped = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: EURUSD_SPEC });
    const clamped = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: EURUSD_SPEC, maxApprovedNotional: 5000 });
    expect(unclamped.approved && clamped.approved).toBe(true);
    if (unclamped.approved && clamped.approved) {
      expect(clamped.volume).toBeLessThan(unclamped.volume);
      expect(clamped.notional).toBeLessThanOrEqual(5000 + 1e-6);
    }
  });

  it("a maxApprovedNotional too small to afford even one volumeStep REJECTS rather than opening oversized", () => {
    const result = calculateMt5PositionSize({ accountEquity: 20000, riskPct: 1, entryPrice: 1.1, stopLoss: 1.095, symbolSpec: EURUSD_SPEC, maxApprovedNotional: 100 });
    expect(result.approved).toBe(false);
    if (!result.approved) expect(result.reason).toBe("BELOW_MINIMUM_VOLUME");
  });
});
