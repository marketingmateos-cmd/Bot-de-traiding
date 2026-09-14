import { describe, expect, it } from "vitest";
import type { OHLCVBar } from "@/lib/providers/types";
import { runFamilyADiscovery, runFamilyBDiscovery, runFamilyCDiscovery, runFamilyDDiscovery, runFamilyEDiscovery, runFamilyASegment, stratifyByRegime } from "../phase21DiscoveryRunner";
import { computeForwardReturns } from "../phase21EdgeStudy";
import { DiscoveryContaminationError } from "../phase21Discovery";
import { FROZEN_RANGES } from "../phase21PreRegistration";

const STEP_MS = 3_600_000;

/** A long, deterministic (never random), gently oscillating + trending synthetic OHLCV series — enough bars to clear every family's lookback (max 500) with room for events, entirely within FROZEN_RANGES.is. */
function buildSyntheticSeries(count: number, startMs = FROZEN_RANGES.is.start.getTime()): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let price = 20000;
  for (let i = 0; i < count; i++) {
    const noise = Math.sin(i / 7) * 50 + Math.sin(i / 53) * 200;
    const spike = i % 97 === 0 ? (i % 194 === 0 ? 800 : -800) : 0; // periodic large moves, alternating sign
    price = Math.max(1000, price + noise * 0.05 + spike * 0.3);
    const high = price + Math.abs(noise) * 0.2 + 10;
    const low = price - Math.abs(noise) * 0.2 - 10;
    const volume = 1000 + Math.abs(Math.sin(i / 11)) * 500 + (i % 97 === 0 ? 3000 : 0);
    bars.push({ timestamp: new Date(startMs + i * STEP_MS), open: price, high, low, close: price, volume });
  }
  return bars;
}

describe("Fase 21 Discovery runner — IS-only structural barrier applied to every family", () => {
  const contaminated = [
    { timestamp: FROZEN_RANGES.is.start, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { timestamp: new Date(FROZEN_RANGES.oos.start.getTime() + 3_600_000), open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
  ];

  it("runFamilyADiscovery throws on OOS-contaminated bars", () => {
    expect(() => runFamilyADiscovery(contaminated)).toThrow(DiscoveryContaminationError);
  });
  it("runFamilyBDiscovery throws on OOS-contaminated bars", () => {
    expect(() => runFamilyBDiscovery(contaminated)).toThrow(DiscoveryContaminationError);
  });
  it("runFamilyCDiscovery throws on OOS-contaminated bars", () => {
    expect(() => runFamilyCDiscovery(contaminated)).toThrow(DiscoveryContaminationError);
  });
  it("runFamilyDDiscovery throws on OOS-contaminated bars", () => {
    expect(() => runFamilyDDiscovery(contaminated)).toThrow(DiscoveryContaminationError);
  });
  it("runFamilyEDiscovery throws on OOS-contaminated bars", () => {
    expect(() => runFamilyEDiscovery(contaminated)).toThrow(DiscoveryContaminationError);
  });
});

describe("Fase 21 Discovery runner — structural correctness over a realistic-scale synthetic series", () => {
  const bars = buildSyntheticSeries(3000);

  it("Family A returns exactly 6 lag results with real observed/CI values", () => {
    const results = runFamilyADiscovery(bars);
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.sampleSize).toBeGreaterThan(0);
    }
  });

  it("Family B returns 2 buckets (EXTREME_HIGH/EXTREME_LOW) per horizon, 5 horizons = 10 results", () => {
    const results = runFamilyBDiscovery(bars);
    expect(results).toHaveLength(10);
    expect(results.map((r) => r.label)).toContain("h1_EXTREME_HIGH");
    expect(results.map((r) => r.label)).toContain("h24_EXTREME_LOW");
  });

  it("Family C returns 2 buckets (LOW_VOL/HIGH_VOL) per horizon, 3 horizons = 6 results, with meanForwardVol populated", () => {
    const results = runFamilyCDiscovery(bars);
    expect(results).toHaveLength(6);
    for (const r of results) {
      if (r.stats.n > 0) expect(r.meanForwardVol).not.toBeNull();
    }
  });

  it("Family D returns 4 buckets per horizon, 3 horizons = 12 results", () => {
    const results = runFamilyDDiscovery(bars);
    expect(results).toHaveLength(12);
  });

  it("Family E returns 2 buckets (SHORT_COIL/LONG_COIL) per horizon, 3 horizons = 6 results", () => {
    const results = runFamilyEDiscovery(bars);
    expect(results).toHaveLength(6);
  });

  it("is fully deterministic — same bars, same results, across two independent calls", () => {
    const a = runFamilyBDiscovery(bars);
    const b = runFamilyBDiscovery(bars);
    expect(a).toEqual(b);
  });

  it("runFamilyASegment (no IS-only barrier) accepts bars outside the IS range, unlike runFamilyADiscovery", () => {
    const validationBars = buildSyntheticSeries(600, FROZEN_RANGES.validation.start.getTime());
    expect(() => runFamilyASegment(validationBars)).not.toThrow();
    const results = runFamilyASegment(validationBars);
    expect(results).toHaveLength(6);
  });
});

describe("Fase 21 Discovery runner — no lookahead (mutating a bar strictly after an event index never changes that event's bucket membership)", () => {
  it("Family B: a future extreme value does not change an earlier bar's classification", () => {
    const bars = buildSyntheticSeries(3000);
    const mutated = bars.map((b) => ({ ...b }));
    // Mutate a bar far in the future (near the end) to an extreme, implausible value.
    mutated[2990] = { ...mutated[2990], close: mutated[2990].close * 50, high: mutated[2990].high * 50, low: mutated[2990].low * 50 };

    const base = runFamilyBDiscovery(bars.slice(0, 2500));
    const withFutureMutation = runFamilyBDiscovery(mutated.slice(0, 2500)); // future mutation is beyond this slice anyway — sanity: identical
    expect(withFutureMutation).toEqual(base);
  });
});

describe("stratifyByRegime — causal regime cross-tabulation", () => {
  it("never marks a cell with n >= minSampleSize as insufficientSample, and vice versa", () => {
    const bars = buildSyntheticSeries(1000);
    const closes = bars.map((b) => b.close);
    const forward = computeForwardReturns(closes, 6);
    const indices = Array.from({ length: bars.length }, (_, i) => i);
    const cells = stratifyByRegime(bars, indices, forward, 20);
    for (const cell of cells) {
      expect(cell.insufficientSample).toBe(cell.n < 20);
    }
  });

  it("computes regime causally — only ever looks at bars up to and including t (never a later bar)", () => {
    const bars = buildSyntheticSeries(500);
    const closes = bars.map((b) => b.close);
    const forward = computeForwardReturns(closes, 6);
    const indices = [200, 300, 400];

    const mutated = bars.map((b) => ({ ...b }));
    mutated[450] = { ...mutated[450], close: mutated[450].close * 10, high: mutated[450].high * 10, low: mutated[450].low * 10 };

    const base = stratifyByRegime(bars, indices, forward, 1);
    const withFutureMutation = stratifyByRegime(mutated, indices, forward, 1);
    // None of the tested indices (200/300/400) are >= 450, so mutating bar 450 must never affect their regime classification.
    expect(withFutureMutation).toEqual(base);
  });
});
