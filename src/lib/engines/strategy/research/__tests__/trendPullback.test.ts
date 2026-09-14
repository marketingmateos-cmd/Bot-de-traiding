import { describe, expect, it } from "vitest";
import { trendPullbackStrategy } from "../trendPullback";
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

function bar(close: number, timestamp: Date, noiseSeed = 0): OHLCVBar {
  const wobble = (noiseSeed % 2 === 0 ? 1 : -1) * 0.1;
  const c = close + wobble;
  return { timestamp, open: c, high: c + 0.4, low: c - 0.4, close: c, volume: 1000 };
}

/** A steady uptrend over `count` bars, price rising ~0.3/bar — establishes SMA20 > SMA50 by the end. */
function buildUptrend(count: number): OHLCVBar[] {
  const now = Date.now();
  const startTs = now - (count + 10) * STEP_MS;
  return Array.from({ length: count }, (_, i) => bar(100 + i * 0.3, new Date(startTs + i * STEP_MS), i));
}

function buildDowntrend(count: number): OHLCVBar[] {
  const now = Date.now();
  const startTs = now - (count + 10) * STEP_MS;
  return Array.from({ length: count }, (_, i) => bar(100 - i * 0.3, new Date(startTs + i * STEP_MS), i));
}

function evaluate(bars: OHLCVBar[]) {
  return trendPullbackStrategy.evaluate(bars, DUMMY_FEATURES, trendPullbackStrategy.defaultParams, "NEUTRAL");
}

describe("TrendPullbackStrategy — correct signal", () => {
  it("fires LONG after a pullback within an established uptrend, once price resumes above the fast MA", () => {
    const trend = buildUptrend(55); // fastMA(20) > slowMA(50) comfortably established
    const lastClose = (trend[trend.length - 1] as { close: number }).close;
    const now = Date.now();
    // pullbackBars(3) of net retracement, ending at `previous`, then `current` resumes upward.
    const pullbackStart = bar(lastClose + 0.2, new Date(now - 4 * STEP_MS));
    const pullback2 = bar(lastClose - 0.3, new Date(now - 3 * STEP_MS));
    const previous = bar(lastClose - 0.9, new Date(now - 2 * STEP_MS)); // net decline vs pullbackStart
    const current = bar(lastClose - 0.5, new Date(now - 1 * STEP_MS)); // close > previous.close: resumption

    const result = evaluate([...trend, pullbackStart, pullback2, previous, current]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.stopLossPrice).toBeLessThan((current as { close: number }).close);
    expect(result?.takeProfitPrice).toBeGreaterThan((current as { close: number }).close);
  });

  it("fires SHORT after a pullback within an established downtrend, once price resumes below the fast MA", () => {
    const trend = buildDowntrend(55);
    const lastClose = (trend[trend.length - 1] as { close: number }).close;
    const now = Date.now();
    const pullbackStart = bar(lastClose - 0.2, new Date(now - 4 * STEP_MS));
    const pullback2 = bar(lastClose + 0.3, new Date(now - 3 * STEP_MS));
    const previous = bar(lastClose + 0.9, new Date(now - 2 * STEP_MS)); // net rise vs pullbackStart
    const current = bar(lastClose + 0.5, new Date(now - 1 * STEP_MS)); // close < previous.close: resumption

    const result = evaluate([...trend, pullbackStart, pullback2, previous, current]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.stopLossPrice).toBeGreaterThan((current as { close: number }).close);
    expect(result?.takeProfitPrice).toBeLessThan((current as { close: number }).close);
  });
});

describe("TrendPullbackStrategy — no signal without all 3 stages", () => {
  it("stays flat when the trend is established but there was no pullback (straight extension)", () => {
    const trend = buildUptrend(55);
    const lastClose = (trend[trend.length - 1] as { close: number }).close;
    const now = Date.now();
    // Straight continuation, no retracement at all.
    const extension = [
      bar(lastClose + 0.3, new Date(now - 3 * STEP_MS)),
      bar(lastClose + 0.6, new Date(now - 2 * STEP_MS)),
      bar(lastClose + 0.9, new Date(now - 1 * STEP_MS)),
      bar(lastClose + 1.2, new Date(now)),
    ];
    expect(evaluate([...trend, ...extension])).toBeNull();
  });

  it("stays flat when there was a pullback but no confirmation (still declining)", () => {
    const trend = buildUptrend(55);
    const lastClose = (trend[trend.length - 1] as { close: number }).close;
    const now = Date.now();
    const pullbackStart = bar(lastClose + 0.2, new Date(now - 4 * STEP_MS));
    const pullback2 = bar(lastClose - 0.3, new Date(now - 3 * STEP_MS));
    const previous = bar(lastClose - 0.9, new Date(now - 2 * STEP_MS));
    const current = bar(lastClose - 1.3, new Date(now - 1 * STEP_MS)); // STILL declining, no resumption
    expect(evaluate([...trend, pullbackStart, pullback2, previous, current])).toBeNull();
  });

  it("stays flat in a flat/rangebound market with no established trend", () => {
    const now = Date.now();
    const flat = Array.from({ length: 60 }, (_, i) => bar(100, new Date(now - (60 - i) * STEP_MS), i));
    expect(evaluate(flat)).toBeNull();
  });
});

describe("TrendPullbackStrategy — no lookahead", () => {
  it("a future resumption bar has no effect until it legitimately becomes the current bar", () => {
    const trend = buildUptrend(55);
    const lastClose = (trend[trend.length - 1] as { close: number }).close;
    const now = Date.now();
    const pullbackStart = bar(lastClose + 0.2, new Date(now - 4 * STEP_MS));
    const pullback2 = bar(lastClose - 0.3, new Date(now - 3 * STEP_MS));
    const previous = bar(lastClose - 0.9, new Date(now - 2 * STEP_MS));
    const setupWithoutCurrent = [...trend, pullbackStart, pullback2, previous];
    expect(evaluate(setupWithoutCurrent)).toBeNull();

    const future = bar(lastClose - 0.5, new Date(now + 100 * STEP_MS));
    const result = evaluate([...setupWithoutCurrent, future]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });
});

describe("TrendPullbackStrategy — insufficient history", () => {
  it("returns null with fewer than slowPeriod+pullbackBars+2 bars", () => {
    const tooFew = buildUptrend(30);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("TrendPullbackStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const trend = buildUptrend(55);
    const lastClose = (trend[trend.length - 1] as { close: number }).close;
    const now = Date.now();
    const bars = [
      ...trend,
      bar(lastClose + 0.2, new Date(now - 4 * STEP_MS)),
      bar(lastClose - 0.3, new Date(now - 3 * STEP_MS)),
      bar(lastClose - 0.9, new Date(now - 2 * STEP_MS)),
      bar(lastClose - 0.5, new Date(now - 1 * STEP_MS)),
    ];
    expect(evaluate(bars)).toEqual(evaluate(bars));
  });
});
