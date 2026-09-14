import { describe, expect, it } from "vitest";
import { volatilityTransitionShockStrategy } from "../volatilityTransitionShock";
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

/**
 * Builds a series that is genuinely LOW_VOLATILITY right up to the last
 * `calmBars` bars (amplitude of per-bar noise decays smoothly toward the
 * tail, so the calmest reading in the whole prior history sits at the very
 * end — the window `detectRegime` sees when Discovery/evaluate truncates
 * the last `transitionWindowBars` bars away), then appends a short burst
 * of extreme bars that is a genuine HIGH_VOLATILITY shock relative to that
 * entire calm history.
 */
function buildTransitionSetup(shockDirection: "UP" | "DOWN", calmBars = 147, transitionWindowBars = 3): OHLCVBar[] {
  const now = Date.now();
  const total = calmBars + transitionWindowBars;
  const bars: OHLCVBar[] = [];
  let lastClose = 100;
  for (let i = 0; i < calmBars; i++) {
    const decay = Math.max(0.01, 1 - i / calmBars);
    const noise = Math.sin(i * 1.31) * decay * 0.4;
    const close = 100 + noise;
    const timestamp = new Date(now - (total - i) * STEP_MS);
    bars.push({ timestamp, open: lastClose, high: Math.max(lastClose, close) + 0.02, low: Math.min(lastClose, close) - 0.02, close, volume: 1000 });
    lastClose = close;
  }

  const shockMagnitude = shockDirection === "UP" ? 1 : -1;
  const anchor = lastClose; // last calm close — every shock bar's magnitude is measured from this FIXED anchor, never compounded, so a DOWN shock can't run the price negative.
  for (let i = 0; i < transitionWindowBars; i++) {
    const open = lastClose;
    const close = anchor + shockMagnitude * (i + 1) * 8;
    const timestamp = new Date(now - (transitionWindowBars - i) * STEP_MS);
    bars.push({ timestamp, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 });
    lastClose = close;
  }

  return bars;
}

function evaluate(bars: OHLCVBar[]) {
  return volatilityTransitionShockStrategy.evaluate(bars, DUMMY_FEATURES, volatilityTransitionShockStrategy.defaultParams, "NEUTRAL");
}

describe("VolatilityTransitionShockStrategy — correct signal", () => {
  it("fires LONG when the LOW->HIGH volatility transition coincides with a net upward price move", () => {
    const bars = buildTransitionSetup("UP");
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.meta?.priorRegime).toBe("LOW_VOLATILITY");
    expect(result?.meta?.currentRegime).toBe("HIGH_VOLATILITY");
  });

  it("fires SHORT when the LOW->HIGH volatility transition coincides with a net downward price move", () => {
    const bars = buildTransitionSetup("DOWN");
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
  });
});

describe("VolatilityTransitionShockStrategy — no signal without a genuine transition", () => {
  it("stays flat before the shock (still calm, no transition yet)", () => {
    const bars = buildTransitionSetup("UP");
    const calmOnly = bars.slice(0, bars.length - 3);
    expect(evaluate(calmOnly)).toBeNull();
  });
});

describe("VolatilityTransitionShockStrategy — no lookahead", () => {
  it("truncating the shock bars away removes the signal entirely", () => {
    const bars = buildTransitionSetup("UP");
    expect(evaluate(bars)).not.toBeNull();
    expect(evaluate(bars.slice(0, bars.length - 3))).toBeNull();
  });
});

describe("VolatilityTransitionShockStrategy — insufficient history", () => {
  it("returns null with fewer than 60+transitionWindowBars+volatilityPeriod bars", () => {
    const bars = buildTransitionSetup("UP").slice(-50);
    expect(evaluate(bars)).toBeNull();
  });
});

describe("VolatilityTransitionShockStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const bars = buildTransitionSetup("UP");
    expect(evaluate(bars)).toEqual(evaluate(bars));
  });
});
