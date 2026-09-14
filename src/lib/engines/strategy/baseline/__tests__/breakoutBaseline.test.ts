import { describe, expect, it } from "vitest";
import { breakoutBaselineStrategy } from "../breakoutBaseline";
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

function makeFlatBars(count: number, price = 100): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(now - (count - i) * stepMs),
    open: price,
    high: price * 1.002,
    low: price * 0.998,
    close: price,
    volume: 1000,
  }));
}

function bar(overrides: Partial<OHLCVBar>, timestamp: Date): OHLCVBar {
  return { timestamp, open: 100, high: 100.2, low: 99.8, close: 100, volume: 1000, ...overrides };
}

function evaluate(bars: OHLCVBar[]) {
  return breakoutBaselineStrategy.evaluate(bars, DUMMY_FEATURES, breakoutBaselineStrategy.defaultParams, "NEUTRAL");
}

describe("BreakoutBaselineStrategy — correct signal", () => {
  it("fires LONG when the current close breaks above the prior lookback's highest high", () => {
    const warmup = makeFlatBars(25, 100); // highs ~100.2, prior window max ~100.2
    const breakoutBar = bar({ close: 106, high: 106.5, low: 105.5 }, new Date());
    const result = evaluate([...warmup, breakoutBar]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.stopLossPrice).toBeLessThan(106);
    expect(result?.takeProfitPrice).toBeGreaterThan(106);
    expect(result?.meta?.breakoutLevel).toBeCloseTo(100.2, 1);
  });

  it("fires SHORT when the current close breaks below the prior lookback's lowest low", () => {
    const warmup = makeFlatBars(25, 100);
    const breakoutBar = bar({ close: 94, high: 94.5, low: 93.5 }, new Date());
    const result = evaluate([...warmup, breakoutBar]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.stopLossPrice).toBeGreaterThan(94);
    expect(result?.takeProfitPrice).toBeLessThan(94);
    expect(result?.meta?.breakoutLevel).toBeCloseTo(99.8, 1);
  });

  it("stays flat (null) when the close never left the prior range", () => {
    const warmup = makeFlatBars(25, 100);
    const flatBar = bar({ close: 100.1, high: 100.15, low: 100.05 }, new Date());
    expect(evaluate([...warmup, flatBar])).toBeNull();
  });
});

describe("BreakoutBaselineStrategy — no lookahead", () => {
  it("the lookback window EXCLUDES the current bar's own high/low — a huge current-bar wick never counts as its own breakout level", () => {
    const warmup = makeFlatBars(25, 100);
    // The current bar's OWN high (500) would dwarf everything if wrongly
    // included in the lookback max — but its CLOSE (101) only clears the
    // prior window's real max (~100.2), so a correct implementation still
    // signals LONG against the prior bars' max, never against its own high.
    const currentBar = bar({ close: 101, high: 500, low: 99.9 }, new Date());
    const result = evaluate([...warmup, currentBar]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.meta?.breakoutLevel).toBeCloseTo(100.2, 1); // the PRIOR window's max, never 500
  });

  it("a future bar's data is invisible until it legitimately becomes the current bar", () => {
    const warmup = makeFlatBars(25, 100);
    const futureBreakoutBar = bar({ close: 106, high: 106.5, low: 105.5 }, new Date(Date.now() + 3_600_000));

    // Evaluated WITHOUT the future bar: no breakout yet.
    expect(evaluate(warmup)).toBeNull();

    // The SAME future bar, once it is legitimately the last (current) bar,
    // fires — proving the strategy is a pure function of "bars up to and
    // including current", never anything beyond it.
    const result = evaluate([...warmup, futureBreakoutBar]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });
});

describe("BreakoutBaselineStrategy — insufficient history", () => {
  it("returns null when there aren't even `lookback` prior bars", () => {
    const tooFew = makeFlatBars(5, 100); // default lookback = 20
    expect(evaluate(tooFew)).toBeNull();
  });
});
