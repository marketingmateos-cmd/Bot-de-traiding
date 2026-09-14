import { describe, expect, it } from "vitest";
import { momentumBaselineStrategy } from "../momentumBaseline";
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

function bar(price: number, timestamp: Date): OHLCVBar {
  return { timestamp, open: price, high: price * 1.002, low: price * 0.998, close: price, volume: 1000 };
}

function evaluate(bars: OHLCVBar[]) {
  return momentumBaselineStrategy.evaluate(bars, DUMMY_FEATURES, momentumBaselineStrategy.defaultParams, "NEUTRAL");
}

describe("MomentumBaselineStrategy — correct signal", () => {
  it("fires LONG on positive momentum beyond the threshold", () => {
    const warmup = makeFlatBars(15, 100);
    const strongUpBar = bar(104, new Date()); // +4% vs. 10-bar-ago close of 100, threshold is 2%
    const result = evaluate([...warmup, strongUpBar]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.stopLossPrice).toBeLessThan(104);
    expect(result?.takeProfitPrice).toBeGreaterThan(104);
  });

  it("fires SHORT on negative momentum beyond the threshold", () => {
    const warmup = makeFlatBars(15, 100);
    const strongDownBar = bar(96, new Date());
    const result = evaluate([...warmup, strongDownBar]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    expect(result?.stopLossPrice).toBeGreaterThan(96);
    expect(result?.takeProfitPrice).toBeLessThan(96);
  });

  it("stays flat when the move is inside the threshold", () => {
    const warmup = makeFlatBars(15, 100);
    const smallMoveBar = bar(100.5, new Date()); // +0.5%, well under the 2% threshold
    expect(evaluate([...warmup, smallMoveBar])).toBeNull();
  });
});

describe("MomentumBaselineStrategy — no lookahead", () => {
  it("the return is computed against a bar strictly BEFORE current, never the current bar's own change vs. a future one", () => {
    const warmup = makeFlatBars(15, 100);
    expect(evaluate(warmup)).toBeNull(); // no momentum yet

    const futureMoveBar = bar(105, new Date(Date.now() + 3_600_000));
    const result = evaluate([...warmup, futureMoveBar]);
    expect(result).not.toBeNull(); // fires only once that bar legitimately IS current
    expect(result?.direction).toBe("LONG");
  });
});

describe("MomentumBaselineStrategy — insufficient history", () => {
  it("returns null when there aren't even `lookback` prior bars", () => {
    const tooFew = makeFlatBars(3, 100); // default lookback = 10
    expect(evaluate(tooFew)).toBeNull();
  });
});
