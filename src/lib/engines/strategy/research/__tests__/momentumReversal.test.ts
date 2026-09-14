import { describe, expect, it } from "vitest";
import { momentumReversalStrategy } from "../momentumReversal";
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

function bar(close: number, timestamp: Date): OHLCVBar {
  return { timestamp, open: close, high: close + 0.3, low: close - 0.3, close, volume: 1000 };
}

function evaluate(bars: OHLCVBar[]) {
  return momentumReversalStrategy.evaluate(bars, DUMMY_FEATURES, momentumReversalStrategy.defaultParams, "NEUTRAL");
}

/** A sustained rally that pushes RSI(14) into overbought, then a final bar whose move is SMALLER than the one before it (deceleration). */
function buildOverboughtWithDeceleration(): OHLCVBar[] {
  const now = Date.now();
  const bars: OHLCVBar[] = [];
  let price = 100;
  const startTs = now - 30 * STEP_MS;
  for (let i = 0; i < 20; i++) {
    price += 1.5; // steady, strong rally -> RSI pushes toward overbought
    bars.push(bar(price, new Date(startTs + i * STEP_MS)));
  }
  // beforePrevious -> previous: a big move (priorMove); previous -> current: a SMALLER move (deceleration).
  const beforePrevious = bar(price, new Date(startTs + 20 * STEP_MS));
  const previous = bar(price + 2, new Date(startTs + 21 * STEP_MS)); // priorMove = 2
  const current = bar(previous.close + 0.3, new Date(startTs + 22 * STEP_MS)); // lastMove = 0.3 < 2
  return [...bars, beforePrevious, previous, current];
}

function buildOversoldWithDeceleration(): OHLCVBar[] {
  const now = Date.now();
  const bars: OHLCVBar[] = [];
  let price = 100;
  const startTs = now - 30 * STEP_MS;
  for (let i = 0; i < 20; i++) {
    price -= 1.5;
    bars.push(bar(price, new Date(startTs + i * STEP_MS)));
  }
  const beforePrevious = bar(price, new Date(startTs + 20 * STEP_MS));
  const previous = bar(price - 2, new Date(startTs + 21 * STEP_MS)); // priorMove = 2
  const current = bar(previous.close - 0.3, new Date(startTs + 22 * STEP_MS)); // lastMove = 0.3 < 2
  return [...bars, beforePrevious, previous, current];
}

describe("MomentumReversalStrategy — correct signal", () => {
  it("fires SHORT when RSI is overbought AND the last move decelerated", () => {
    const setup = buildOverboughtWithDeceleration();
    const result = evaluate(setup);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const last = setup[setup.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(last);
    expect(result?.takeProfitPrice).toBeLessThan(last);
    expect(result?.meta?.rsi as number).toBeGreaterThanOrEqual(75);
  });

  it("fires LONG when RSI is oversold AND the last move decelerated", () => {
    const setup = buildOversoldWithDeceleration();
    const result = evaluate(setup);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const last = setup[setup.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(last);
    expect(result?.takeProfitPrice).toBeGreaterThan(last);
  });
});

describe("MomentumReversalStrategy — no signal without both conditions", () => {
  it("stays flat when RSI is overbought but the move is still ACCELERATING (no exhaustion)", () => {
    const now = Date.now();
    const bars: OHLCVBar[] = [];
    let price = 100;
    const startTs = now - 30 * STEP_MS;
    for (let i = 0; i < 20; i++) {
      price += 1.5;
      bars.push(bar(price, new Date(startTs + i * STEP_MS)));
    }
    const beforePrevious = bar(price, new Date(startTs + 20 * STEP_MS));
    const previous = bar(price + 1, new Date(startTs + 21 * STEP_MS)); // priorMove = 1
    const current = bar(previous.close + 3, new Date(startTs + 22 * STEP_MS)); // lastMove = 3 > 1: ACCELERATING
    expect(evaluate([...bars, beforePrevious, previous, current])).toBeNull();
  });

  it("stays flat when the move decelerated but RSI is nowhere near an extreme", () => {
    const now = Date.now();
    const bars: OHLCVBar[] = [];
    let price = 100;
    const startTs = now - 30 * STEP_MS;
    // Mild, back-and-forth wobble — RSI stays near 50, never extreme.
    for (let i = 0; i < 20; i++) {
      price += i % 2 === 0 ? 0.3 : -0.25;
      bars.push(bar(price, new Date(startTs + i * STEP_MS)));
    }
    const beforePrevious = bar(price + 0.5, new Date(startTs + 20 * STEP_MS));
    const previous = bar(price + 0.7, new Date(startTs + 21 * STEP_MS)); // priorMove = 0.2
    const current = bar(previous.close + 0.75, new Date(startTs + 22 * STEP_MS)); // lastMove = 0.05 < 0.2 (decelerating), but RSI mid-range
    expect(evaluate([...bars, beforePrevious, previous, current])).toBeNull();
  });
});

describe("MomentumReversalStrategy — no lookahead", () => {
  it("a future exhaustion bar has no effect until it legitimately becomes the current bar", () => {
    const setup = buildOverboughtWithDeceleration();
    const withoutLast = setup.slice(0, -1);
    expect(evaluate(withoutLast)).toBeNull();

    const last = setup[setup.length - 1];
    const future = { ...last, timestamp: new Date(last.timestamp.getTime() + 100 * STEP_MS) };
    const result = evaluate([...withoutLast, future]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
  });
});

describe("MomentumReversalStrategy — insufficient history", () => {
  it("returns null with fewer than rsiPeriod+3 bars", () => {
    const now = Date.now();
    const tooFew = Array.from({ length: 10 }, (_, i) => bar(100 + i, new Date(now - (10 - i) * STEP_MS)));
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("MomentumReversalStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const setup = buildOverboughtWithDeceleration();
    expect(evaluate(setup)).toEqual(evaluate(setup));
  });
});
