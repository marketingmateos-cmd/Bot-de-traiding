import { describe, expect, it } from "vitest";
import { breakoutConfirmationStrategy } from "../breakoutConfirmation";
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

function makeFlatBars(count: number, price = 100, volume = 1000): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(now - (count - i) * stepMs),
    open: price,
    high: price * 1.002,
    low: price * 0.998,
    close: price,
    volume,
  }));
}

function bar(overrides: Partial<OHLCVBar>, timestamp: Date): OHLCVBar {
  return { timestamp, open: 100, high: 100.2, low: 99.8, close: 100, volume: 1000, ...overrides };
}

function evaluate(bars: OHLCVBar[]) {
  return breakoutConfirmationStrategy.evaluate(bars, DUMMY_FEATURES, breakoutConfirmationStrategy.defaultParams, "NEUTRAL");
}

describe("BreakoutConfirmationStrategy — correct signal", () => {
  it("fires LONG on a breakout that closes strong (top of its own range) with a volume spike", () => {
    const warmup = makeFlatBars(25, 100);
    // Close near the bar's own high (strong close position) + volume spike.
    const confirmedBreakout = bar({ close: 106, high: 106.2, low: 105, volume: 6000 }, new Date());
    const result = evaluate([...warmup, confirmedBreakout]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    expect(result?.meta?.closePosition).toBeGreaterThanOrEqual(0.7);
    expect(result?.meta?.volumeZ).toBeGreaterThanOrEqual(1);
  });

  it("fires SHORT on a breakdown that closes strong (bottom of its own range) with a volume spike", () => {
    const warmup = makeFlatBars(25, 100);
    const confirmedBreakdown = bar({ close: 94, high: 95, low: 93.8, volume: 6000 }, new Date());
    const result = evaluate([...warmup, confirmedBreakdown]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
  });
});

describe("BreakoutConfirmationStrategy — no signal without both confirmations", () => {
  it("stays flat on a breakout that closes weak within its own range (even with volume)", () => {
    const warmup = makeFlatBars(25, 100);
    // Breaks the range, but closes near the MIDDLE of the bar's own high/low — weak close position.
    const weakClose = bar({ close: 106, high: 108, low: 104, volume: 6000 }, new Date());
    expect(evaluate([...warmup, weakClose])).toBeNull();
  });

  it("stays flat on a strong-closing breakout without a volume spike", () => {
    const warmup = makeFlatBars(25, 100);
    const noVolume = bar({ close: 106, high: 106.2, low: 105, volume: 1000 }, new Date());
    expect(evaluate([...warmup, noVolume])).toBeNull();
  });

  it("stays flat (null) when the close never left the prior range at all", () => {
    const warmup = makeFlatBars(25, 100);
    const flatBar = bar({ close: 100.1, high: 100.15, low: 100.05, volume: 6000 }, new Date());
    expect(evaluate([...warmup, flatBar])).toBeNull();
  });
});

describe("BreakoutConfirmationStrategy — no lookahead", () => {
  it("the lookback window EXCLUDES the current bar's own high/low", () => {
    const warmup = makeFlatBars(25, 100);
    const currentBar = bar({ close: 101, high: 500, low: 99.9, volume: 6000 }, new Date());
    // Close of 101 doesn't clear the prior window's max (~100.2) by a strong margin relative to its
    // own (huge) range, so closePosition against its OWN high/low would be tiny — never fires purely
    // because of its own outlier high.
    const result = evaluate([...warmup, currentBar]);
    expect(result).toBeNull();
  });

  it("a future confirmed breakout has no effect until it legitimately becomes the current bar", () => {
    const warmup = makeFlatBars(25, 100);
    const futureBar = bar({ close: 106, high: 106.2, low: 105, volume: 6000 }, new Date(Date.now() + 3_600_000));
    expect(evaluate(warmup)).toBeNull();
    const result = evaluate([...warmup, futureBar]);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
  });
});

describe("BreakoutConfirmationStrategy — insufficient history", () => {
  it("returns null when there aren't even `lookback` prior bars", () => {
    const tooFew = makeFlatBars(5, 100);
    expect(evaluate(tooFew)).toBeNull();
  });
});

describe("BreakoutConfirmationStrategy — deterministic output", () => {
  it("the exact same input bars always produce the exact same signal", () => {
    const warmup = makeFlatBars(25, 100);
    const bars = [...warmup, bar({ close: 106, high: 106.2, low: 105, volume: 6000 }, new Date())];
    expect(evaluate(bars)).toEqual(evaluate(bars));
  });
});
