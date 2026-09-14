import type { OHLCVBar } from "@/lib/providers/types";
import { computeLogReturns, computeAutocorrelation, computeAutocorrelationWithBootstrapCI, type AutocorrelationBootstrapCI } from "@/lib/engines/edgeSignals/autocorrelation";
import { tagAsIsOnly } from "./phase20Discovery";
import { F20A_LAGS_HOURS, F20A_BOOTSTRAP_CONFIG, FROZEN_RANGES, FROZEN_WALK_FORWARD_OPTIONS } from "./phase20PreRegistration";

/**
 * Fase 20 — Family A: Return Autocorrelation Structure. Spec Condición 4 —
 * F20-A is a PURE STATISTICAL STUDY, never auto-converted into a trading
 * strategy: this module only computes ρ(k) (the sample ACF, from
 * `engines/edgeSignals/autocorrelation.ts`) across IS/VALIDATION/OOS and a
 * walk-forward sign-stability check, for each of the 6 frozen lags. A
 * statistically significant ρ(k) here means "evidence of serial
 * dependence exists" — it is NOT, by itself, a claim of a tradable edge.
 *
 * Discovery (IS) goes through `tagAsIsOnly` (spec Condición 2 — the
 * structural barrier), so this module CANNOT be called with VALIDATION/OOS
 * bars mislabeled as Discovery input. Validation/OOS/walk-forward
 * statistics are computed with the SAME formula on plain (untagged) bars —
 * that later stage is legitimately allowed to see the full dataset, it is
 * only Discovery that is walled off.
 */

export interface LagAcfResult {
  lag: number;
  sampleSize: number;
  observed: number | null;
  ciLow: number | null;
  ciHigh: number | null;
}

function acfForLags(bars: OHLCVBar[], lags: readonly number[]): LagAcfResult[] {
  const closes = bars.map((b) => b.close);
  const returns = computeLogReturns(closes);
  return lags.map((lag) => {
    const ci: AutocorrelationBootstrapCI = computeAutocorrelationWithBootstrapCI(returns, lag, F20A_BOOTSTRAP_CONFIG);
    return { lag, sampleSize: returns.length, observed: ci.observed, ciLow: ci.ciLow, ciHigh: ci.ciHigh };
  });
}

/** Discovery-stage ACF over IS data ONLY — `bars` must already be the full candidate set; this function itself enforces the IS-only boundary via `tagAsIsOnly`, so passing VALIDATION/OOS bars throws rather than silently computing on them. */
export function runFamilyADiscovery(bars: OHLCVBar[], lags: readonly number[] = F20A_LAGS_HOURS): LagAcfResult[] {
  const isOnlyBars = tagAsIsOnly(bars);
  return acfForLags(isOnlyBars, lags);
}

/** Same ACF computation applied to a VALIDATION or OOS bar set — legitimately outside the IS-only barrier (this stage is allowed to see that data), so it takes plain `OHLCVBar[]`, never `IsOnlyBars`. */
export function runFamilyASegment(bars: OHLCVBar[], lags: readonly number[] = F20A_LAGS_HOURS): LagAcfResult[] {
  return acfForLags(bars, lags);
}

export interface WalkForwardWindowBoundary {
  windowIndex: number;
  windowStart: number;
  windowEnd: number;
  trainEnd: number;
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Same window-boundary formula `replayWalkForward.ts`'s `runReplayWalkForward`
 * already uses (windowSizeDays/trainFraction/stepDays), reimplemented here
 * as a pure boundary computation because F20-A never runs a strategy
 * through the replay engine — there is nothing for the full replay
 * machinery to execute, only bars to slice. Keeping the exact same formula
 * (not re-derived independently) means these windows land on the same
 * boundaries Fase 18/19's own walk-forward already used over this dataset.
 */
export function computeWalkForwardWindowBoundaries(start: Date, end: Date, options: { windowSizeDays: number; trainFraction: number; stepDays: number }): WalkForwardWindowBoundary[] {
  const windowMs = options.windowSizeDays * DAY_MS;
  const stepMs = options.stepDays * DAY_MS;
  const windows: WalkForwardWindowBoundary[] = [];
  let windowIndex = 0;
  for (let windowStart = start.getTime(); windowStart + windowMs <= end.getTime(); windowStart += stepMs) {
    const windowEnd = windowStart + windowMs;
    const trainEnd = windowStart + Math.floor(windowMs * options.trainFraction);
    if (trainEnd <= windowStart || windowEnd <= trainEnd) continue;
    windows.push({ windowIndex, windowStart, windowEnd, trainEnd });
    windowIndex++;
  }
  return windows;
}

export interface LagSignStability {
  lag: number;
  fullSampleSign: number; // -1 | 0 | 1, sign of the ACF over the ENTIRE is+validation+oos range
  windowCount: number;
  sameSignWindowCount: number;
  sameSignFraction: number; // 0 when windowCount === 0 (meaningless, never NaN)
}

/**
 * Walk-forward sign stability (spec Condición 4): for each frozen lag,
 * computes ρ(k) on the TEST/OOS portion of every walk-forward window
 * (`[trainEnd, windowEnd)`, same train/test convention as
 * `runReplayWalkForward`) and reports what fraction of windows agree in
 * SIGN with the full-sample ρ(k) — a simple, pre-specified stability
 * check, not a new significance test.
 */
export function runFamilyAWalkForward(fullRangeBars: OHLCVBar[], fullRange: { start: Date; end: Date }, options = FROZEN_WALK_FORWARD_OPTIONS, lags: readonly number[] = F20A_LAGS_HOURS): LagSignStability[] {
  const windows = computeWalkForwardWindowBoundaries(fullRange.start, fullRange.end, options);
  const fullSampleAcf = acfForLags(fullRangeBars, lags);
  const fullSampleSignByLag = new Map(fullSampleAcf.map((r) => [r.lag, r.observed === null ? 0 : Math.sign(r.observed)]));

  return lags.map((lag) => {
    const fullSampleSign = fullSampleSignByLag.get(lag) ?? 0;
    let sameSignWindowCount = 0;
    let windowCount = 0;
    for (const w of windows) {
      const testBars = fullRangeBars.filter((b) => b.timestamp.getTime() >= w.trainEnd && b.timestamp.getTime() < w.windowEnd);
      const closes = testBars.map((b) => b.close);
      const returns = computeLogReturns(closes);
      const rho = computeAutocorrelation(returns, lag);
      if (rho === null) continue;
      windowCount++;
      if (Math.sign(rho) === fullSampleSign && fullSampleSign !== 0) sameSignWindowCount++;
    }
    return { lag, fullSampleSign, windowCount, sameSignWindowCount, sameSignFraction: windowCount === 0 ? 0 : sameSignWindowCount / windowCount };
  });
}

/** Convenience slice: bars whose timestamp falls within [range.start, range.end] (inclusive), matching the same inclusive convention `runIsValidationOosReplay`'s own segment boundaries use. */
export function sliceBarsToRange(bars: OHLCVBar[], range: { start: Date; end: Date }): OHLCVBar[] {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  return bars.filter((b) => {
    const t = b.timestamp.getTime();
    return t >= startMs && t <= endMs;
  });
}

/** Convenience alias so callers don't need to import FROZEN_RANGES separately just to slice IS bars. */
export function sliceIsBars(bars: OHLCVBar[]): OHLCVBar[] {
  return sliceBarsToRange(bars, FROZEN_RANGES.is);
}
