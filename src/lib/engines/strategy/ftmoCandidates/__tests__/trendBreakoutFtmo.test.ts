import { describe, expect, it } from "vitest";
import { trendBreakoutFtmoStrategy } from "../trendBreakoutFtmo";
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

function makeTrendingBars(count: number, startPrice: number, driftPerBar: number): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  let price = startPrice;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    price = price * (1 + driftPerBar);
    return { timestamp: new Date(now - (count - i) * stepMs), open, high: Math.max(open, price) * 1.001, low: Math.min(open, price) * 0.999, close: price, volume: 1000 };
  });
}

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
  return trendBreakoutFtmoStrategy.evaluate(bars, DUMMY_FEATURES, trendBreakoutFtmoStrategy.defaultParams, "BULL");
}

describe("TrendBreakoutFtmoStrategy — correct signal", () => {
  it("fires LONG when a breakout aligns with an established uptrend (close above both the lookback window's high and SMA50)", () => {
    const bars = makeTrendingBars(60, 100, 0.004);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = bars[bars.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);
  });

  it("fires SHORT when a breakdown aligns with an established downtrend (close below both the lookback window's low and SMA50)", () => {
    const bars = makeTrendingBars(60, 100, -0.004);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
    const entry = bars[bars.length - 1].close;
    expect(result?.stopLossPrice).toBeGreaterThan(entry);
    expect(result?.takeProfitPrice).toBeLessThan(entry);
  });

  it("stays flat when there is no breakout (price never leaves the recent range)", () => {
    const bars = makeFlatBars(55, 100);
    expect(evaluate(bars)).toBeNull();
  });
});

describe("TrendBreakoutFtmoStrategy — trend filter discipline", () => {
  it("discards a breakout that goes against the trend filter, even though the raw breakout condition is met", () => {
    // Steep decline for 30 bars (drags SMA50 up, since it still averages the
    // much-higher early prices), then 20 flat bars near the bottom (a tight
    // recent window), then a small bounce that clears the tight window's
    // high — a raw breakout — but stays well BELOW the still-elevated SMA50.
    // The trend filter must reject it: never relaxed to a weaker signal.
    const decline = Array.from({ length: 30 }, (_, i) => 140 * Math.pow(100 / 140, i / 29));
    const flat = Array.from({ length: 20 }, () => 100);
    const closes = [...decline, ...flat];
    const now = Date.now();
    const stepMs = 3_600_000;
    const total = closes.length + 1;
    const history: OHLCVBar[] = closes.map((close, i) => ({
      timestamp: new Date(now - (total - i) * stepMs),
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 1000,
    }));
    const bounceClose = flat[flat.length - 1] * 1.01;
    const bounceBar = bar({ close: bounceClose, high: bounceClose * 1.001, low: bounceClose * 0.999 }, new Date(now));
    expect(evaluate([...history, bounceBar])).toBeNull();
  });
});

describe("TrendBreakoutFtmoStrategy — no lookahead", () => {
  it("the lookback window excludes the current bar's own high — a huge current-bar wick never becomes its own breakout level", () => {
    const uptrend = makeTrendingBars(60, 100, 0.004);
    const legitResult = evaluate(uptrend);
    expect(legitResult).not.toBeNull();
    const lastBar = uptrend[uptrend.length - 1];
    const rigged = [...uptrend.slice(0, -1), { ...lastBar, high: lastBar.high * 10 }];
    const riggedResult = evaluate(rigged);
    expect(riggedResult).not.toBeNull();
    expect(riggedResult?.meta?.breakoutLevel).toBeCloseTo(Number(legitResult?.meta?.breakoutLevel), 5);
  });
});

describe("TrendBreakoutFtmoStrategy — insufficient history", () => {
  it("returns null when there aren't even `trendFilterPeriod` prior bars", () => {
    const tooFew = makeTrendingBars(30, 100, 0.004); // default trendFilterPeriod = 50
    expect(evaluate(tooFew)).toBeNull();
  });
});
