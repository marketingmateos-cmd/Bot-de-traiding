import { describe, expect, it } from "vitest";
import { sniperHighConvictionFtmoStrategy } from "../sniperHighConvictionFtmo";
import { momentumBreakoutFtmoStrategy } from "../momentumBreakoutFtmo";
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

const { volatilityPeriod, compressionLookback, baselinePeriod, volumeLookback, volumeMultiplier, bodyAtrMultiplier, compressionThreshold, riskScaleFactor } =
  sniperHighConvictionFtmoStrategy.defaultParams as {
    volatilityPeriod: number;
    compressionLookback: number;
    baselinePeriod: number;
    volumeLookback: number;
    volumeMultiplier: number;
    bodyAtrMultiplier: number;
    compressionThreshold: number;
    riskScaleFactor: number;
  };

function makeBarsFromCloses(closes: number[], wobblePct: number, volume = 1000): OHLCVBar[] {
  const now = Date.now();
  const stepMs = 3_600_000;
  const count = closes.length;
  return closes.map((close, i) => ({
    timestamp: new Date(now - (count - i) * stepMs),
    open: close,
    high: close * (1 + wobblePct),
    low: close * (1 - wobblePct),
    close,
    volume,
  }));
}

/**
 * Same compression-then-trigger fixture shape as Candidata D's test suite
 * (baseline moderate volatility, then a PURE-compression block at least
 * `volatilityPeriod + compressionLookback` bars long so ATR's own 14-bar
 * smoothing never blends baseline into the recent window), extended with
 * an explicit trigger-bar volume so the volume-spike gate can be exercised
 * independently of the price/compression gates.
 */
function makeSniperFixture(direction: "LONG" | "SHORT", jumpPct: number, compressionWobblePct: number, triggerVolume: number, baselineWobblePct = 0.006): OHLCVBar[] {
  const compressionBlockLen = volatilityPeriod + compressionLookback;
  const baselineCloses = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 0.4 : -0.4));
  const baselineBars = makeBarsFromCloses(baselineCloses, baselineWobblePct);
  const lastBaseline = baselineCloses[baselineCloses.length - 1];
  const compressionCloses = Array.from({ length: compressionBlockLen }, (_, i) => lastBaseline + (i % 2 === 0 ? 0.02 : -0.02));
  const compressionBars = makeBarsFromCloses(compressionCloses, compressionWobblePct);
  const lastCompressionClose = compressionCloses[compressionCloses.length - 1];
  const sign = direction === "LONG" ? 1 : -1;
  const triggerOpen = lastCompressionClose;
  const triggerClose = lastCompressionClose * (1 + sign * jumpPct);
  const triggerBar: OHLCVBar = {
    timestamp: new Date(),
    open: triggerOpen,
    high: Math.max(triggerOpen, triggerClose) * 1.001,
    low: Math.min(triggerOpen, triggerClose) * 0.999,
    close: triggerClose,
    volume: triggerVolume,
  };
  return [...baselineBars, ...compressionBars, triggerBar];
}

function evaluate(bars: OHLCVBar[]) {
  return sniperHighConvictionFtmoStrategy.evaluate(bars, DUMMY_FEATURES, sniperHighConvictionFtmoStrategy.defaultParams, "TRANSITION");
}

describe("SniperHighConvictionFtmoStrategy — stricter thresholds than Candidata D (by declared params)", () => {
  it("has a higher body-energy multiplier than Candidata D", () => {
    const dBody = momentumBreakoutFtmoStrategy.defaultParams.bodyAtrMultiplier as number;
    expect(bodyAtrMultiplier).toBeGreaterThan(dBody);
    expect(bodyAtrMultiplier).toBe(2);
  });

  it("has a lower (stricter) compression threshold than Candidata D", () => {
    const dThreshold = momentumBreakoutFtmoStrategy.defaultParams.compressionThreshold as number;
    expect(compressionThreshold).toBeLessThan(dThreshold);
    expect(compressionThreshold).toBe(0.5);
  });
});

describe("SniperHighConvictionFtmoStrategy — correct signal (all 4 conditions satisfied)", () => {
  it("fires LONG with a massive body, a genuine volume spike, deep compression, and a real breakout", () => {
    // Trigger volume 2500 vs. a baseline/compression volume of 1000 —
    // exactly 2.5x, comfortably above the 2.0x volumeMultiplier gate.
    const bars = makeSniperFixture("LONG", 0.02, 0.0001, 2500);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("LONG");
    const entry = bars[bars.length - 1].close;
    expect(result?.stopLossPrice).toBeLessThan(entry);
    expect(result?.takeProfitPrice).toBeGreaterThan(entry);
  });

  it("fires SHORT symmetrically", () => {
    const bars = makeSniperFixture("SHORT", 0.02, 0.0001, 2500);
    const result = evaluate(bars);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("SHORT");
  });
});

describe("SniperHighConvictionFtmoStrategy — R:R 1:4 and aggressive sizing", () => {
  it("computes TP at exactly 4x the risk distance, and reports the aggressive riskScaleFactor on the signal", () => {
    const bars = makeSniperFixture("LONG", 0.02, 0.0001, 2500);
    const result = evaluate(bars);
    expect(result).not.toBeNull();

    const { rrr } = sniperHighConvictionFtmoStrategy.defaultParams as { rrr: number };
    expect(rrr).toBe(4);

    const entry = bars[bars.length - 1].close;
    const stopDistance = entry - (result?.stopLossPrice as number);
    expect(result?.takeProfitPrice).toBeCloseTo(entry + stopDistance * rrr, 2);

    // Aggressive sizing: > 1, unlike every other FTMO candidate.
    expect(riskScaleFactor).toBe(2);
    expect(result?.riskScaleFactor).toBe(2);
    expect(result?.meta?.riskScaleFactor).toBe(2);
  });
});

describe("SniperHighConvictionFtmoStrategy — volume-spike discipline (new mechanism, unique to Candidata E)", () => {
  it("discards an otherwise-perfect signal (massive body, deep compression, real breakout) when volume does NOT spike", () => {
    // Trigger bar volume equal to the baseline/compression volume (1000) —
    // ratio 1.0x, well below the 2.0x gate — even though every other
    // condition is satisfied exactly as in the correct-signal test.
    const bars = makeSniperFixture("LONG", 0.02, 0.0001, 1000);
    expect(evaluate(bars)).toBeNull();
  });

  it("fires once volume crosses the 2.0x threshold, using the same bars otherwise", () => {
    const belowThreshold = makeSniperFixture("LONG", 0.02, 0.0001, 1999);
    const atThreshold = makeSniperFixture("LONG", 0.02, 0.0001, 2000);
    expect(evaluate(belowThreshold)).toBeNull();
    expect(evaluate(atThreshold)).not.toBeNull();
  });
});

describe("SniperHighConvictionFtmoStrategy — energy discipline stricter than Candidata D", () => {
  it("discards a breakout whose body clears Candidata D's 1.5x threshold but not Candidata E's 2.0x", () => {
    // jump=0.0012 on this exact fixture shape empirically lands body/ATR
    // around 1.7 — above D's 1.5x gate, below E's 2.0x gate.
    const bars = makeSniperFixture("LONG", 0.0012, 0.0001, 2500);
    const dResult = momentumBreakoutFtmoStrategy.evaluate(bars, DUMMY_FEATURES, momentumBreakoutFtmoStrategy.defaultParams, "TRANSITION");
    expect(dResult).not.toBeNull(); // Candidata D fires on this exact same body size
    expect(evaluate(bars)).toBeNull(); // Candidata E does not
  });
});

describe("SniperHighConvictionFtmoStrategy — compression discipline", () => {
  it("discards a high-energy, high-volume breakout when the market was NOT actually compressed beforehand", () => {
    const bars = makeSniperFixture("LONG", 0.02, 0.006, 2500, 0.006); // compression wobble == baseline wobble, no real contraction
    expect(evaluate(bars)).toBeNull();
  });
});

describe("SniperHighConvictionFtmoStrategy — no lookahead", () => {
  it("the compressed range level and the volume baseline both use only the PRIOR bars, never the current one", () => {
    const bars = makeSniperFixture("LONG", 0.02, 0.0001, 2500);
    const result = evaluate(bars);
    expect(result).not.toBeNull();

    const priorRangeWindow = bars.slice(-compressionLookback - 1, -1);
    const expectedRangeHigh = Math.max(...priorRangeWindow.map((b) => b.high));
    expect(result?.meta?.rangeLevel).toBeCloseTo(expectedRangeHigh, 6);

    const priorVolumeWindow = bars.slice(-volumeLookback - 1, -1).map((b) => b.volume);
    const expectedAvgVolume = priorVolumeWindow.reduce((a, b) => a + b, 0) / priorVolumeWindow.length;
    const currentVolume = bars[bars.length - 1].volume;
    const expectedVolumeRatio = currentVolume / expectedAvgVolume;
    expect(result?.meta?.volumeRatio).toBeCloseTo(expectedVolumeRatio, 6);
  });
});

describe("SniperHighConvictionFtmoStrategy — insufficient history", () => {
  it("returns null when there aren't even enough bars for the baseline/compression/volume windows", () => {
    const tooFew = makeSniperFixture("LONG", 0.02, 0.0001, 2500).slice(-40);
    const minBars = Math.max(volatilityPeriod, baselinePeriod, volumeLookback) + compressionLookback + 2;
    expect(tooFew.length).toBeLessThan(minBars);
    expect(evaluate(tooFew)).toBeNull();
  });
});
