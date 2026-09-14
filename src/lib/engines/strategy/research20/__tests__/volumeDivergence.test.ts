import { describe, expect, it } from "vitest";
import { volumeDivergenceStrategy } from "../volumeDivergence";
import type { OHLCVBar } from "@/lib/providers/types";
import type { FeatureSnapshot } from "@/lib/engines/features";

const DUMMY_FEATURES: FeatureSnapshot = {
  close: 100,
  sma20: null,
  sma50: null,
  ema20: null,
  rsi14: null,
  macdHistogram: null,
  atr14: null,
  bbUpper: null,
  bbLower: null,
  volatility20: null,
  volumeZScore20: null,
  trend: 0,
  momentum: 0,
};

const STEP_MS = 3_600_000;

function rangeBar(close: number, volume: number, timestamp: Date): OHLCVBar {
  return { timestamp, open: close, high: close + 0.5, low: close - 0.5, close, volume };
}

/** ~35 bars of moderate, varied history (so ATR is well-defined and stable average volume) followed by a "current" bar appended by the caller. */
function buildBaseHistory(): OHLCVBar[] {
  const now = Date.now();
  const total = 35;
  return Array.from({ length: total }, (_, i) => rangeBar(100 + (i % 5) * 0.3, 1000, new Date(now - (total + 1 - i) * STEP_MS)));
}

function evaluate(bars: OHLCVBar[]) {
  return volumeDivergenceStrategy.evaluate(bars, DUMMY_FEATURES, volumeDivergenceStrategy.defaultParams, "NEUTRAL");
}

describe("VolumeDivergenceStrategy — correct signal", () => {
  it("fires SHORT on a new high made with abnormally low volume", () => {
    const setup = buildBaseHistory();
    const now = Date.now();
    // New high (above every prior bar's high ~101.7) but volume far below the ~1000 average.
    const current = rangeBar(105, 300, new Date(now - STEP_MS));
    const result = evaluate([...setup, current]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.stopLossPrice).toBeGreaterThan(105);
    expect(result?.takeProfitPrice).toBeLessThan(105);
  });

  it("fires LONG on a new low made with abnormally low volume", () => {
    const setup = buildBaseHistory();
    const now = Date.now();
    const current = rangeBar(94, 300, new Date(now - STEP_MS));
    const result = evaluate([...setup, current]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.stopLossPrice).toBeLessThan(94);
    expect(result?.takeProfitPrice).toBeGreaterThan(94);
  });
});

describe("VolumeDivergenceStrategy — no signal without genuine divergence", () => {
  it("stays flat on a new high confirmed by strong volume (no divergence)", () => {
    const setup = buildBaseHistory();
    const now = Date.now();
    const current = rangeBar(105, 1500, new Date(now - STEP_MS)); // above avg volume — confirmed, not divergent
    expect(evaluate([...setup, current])).toBeNull();
  });

  it("stays flat when volume is low but no new extreme was made", () => {
    const setup = buildBaseHistory();
    const now = Date.now();
    const current = rangeBar(100.1, 300, new Date(now - STEP_MS)); // low volume but inside the existing range
    expect(evaluate([...setup, current])).toBeNull();
  });
});

describe("VolumeDivergenceStrategy — no lookahead", () => {
  it("a future low-volume extreme bar has no effect until it legitimately becomes the current bar", () => {
    const setup = buildBaseHistory();
    expect(evaluate(setup)).toBeNull();
    const now = Date.now();
    const future = rangeBar(105, 300, new Date(now + STEP_MS));
    const result = evaluate([...setup, future]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
  });
});

describe("VolumeDivergenceStrategy — insufficient history", () => {
  it("returns null with fewer than lookback+1+volatilityPeriod bars", () => {
    const tooFew = buildBaseHistory().slice(-10);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("VolumeDivergenceStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const setup = buildBaseHistory();
    const now = Date.now();
    const bars = [...setup, rangeBar(105, 300, new Date(now - STEP_MS))];
    expect(evaluate(bars)).toEqual(evaluate(bars));
  });
});
