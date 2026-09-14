import { mulberry32 } from "@/lib/providers/market-data/seeded-random";

/**
 * Fase 20-A — Return Autocorrelation Structure. Pure statistical primitives,
 * deliberately NOT reusing `correlation()` from `riskEngine.ts` (that
 * function correlates two INDEPENDENT series; here we need the standard
 * single-global-mean/variance sample ACF of ONE series against a lagged
 * copy of itself, which is a distinct estimator with a distinct
 * denominator convention). Kept standalone so Fase 20-A's own formula is
 * fully self-contained and auditable in one file, per the spec's
 * requirement that F20-A's formula be frozen and legible on its own.
 */

/** Log returns r_t = ln(close_t / close_{t-1}). First element of the input has no prior close, so the output has length closes.length - 1. */
export function computeLogReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev <= 0 || curr <= 0) {
      out.push(0);
      continue;
    }
    out.push(Math.log(curr / prev));
  }
  return out;
}

/**
 * Sample autocorrelation at lag k, standard single-global-mean/variance
 * estimator: ρ(k) = Σ_{t=1}^{n-k} (x_t - mean)(x_{t+k} - mean) / Σ_{t=1}^{n} (x_t - mean)².
 * Returns null when there isn't enough data for the lag to be meaningful.
 */
export function computeAutocorrelation(returns: number[], lag: number): number | null {
  const n = returns.length;
  if (lag < 1 || n < lag + 2) return null;

  const mean = returns.reduce((sum, v) => sum + v, 0) / n;
  let denominator = 0;
  for (let t = 0; t < n; t++) {
    denominator += (returns[t] - mean) ** 2;
  }
  if (denominator === 0) return null;

  let numerator = 0;
  for (let t = 0; t < n - lag; t++) {
    numerator += (returns[t] - mean) * (returns[t + lag] - mean);
  }
  return numerator / denominator;
}

export interface AutocorrelationBootstrapCI {
  observed: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  bootstrapSamples: number;
}

/**
 * Block-bootstrap confidence interval for ρ(k): resamples contiguous
 * blocks of the RETURN series (preserving short-range dependence within
 * each block, unlike an i.i.d. resample) with a `mulberry32`-seeded RNG
 * for full determinism, recomputes ρ(k) on each resampled series, and
 * reports the 2.5/97.5 percentiles as a 95% CI.
 */
export function computeAutocorrelationWithBootstrapCI(returns: number[], lag: number, options: { iterations: number; seed: number; blockSize: number }): AutocorrelationBootstrapCI {
  const observed = computeAutocorrelation(returns, lag);
  const n = returns.length;
  if (observed === null || n < options.blockSize * 2) {
    return { observed, ciLow: null, ciHigh: null, bootstrapSamples: 0 };
  }

  const rand = mulberry32(options.seed);
  const blockSize = Math.max(1, options.blockSize);
  const numBlocks = Math.ceil(n / blockSize);
  const samples: number[] = [];

  for (let iter = 0; iter < options.iterations; iter++) {
    const resampled: number[] = [];
    for (let b = 0; b < numBlocks; b++) {
      const startIdx = Math.floor(rand() * (n - blockSize + 1));
      for (let j = 0; j < blockSize && resampled.length < n; j++) {
        resampled.push(returns[startIdx + j]);
      }
    }
    const rho = computeAutocorrelation(resampled, lag);
    if (rho !== null) samples.push(rho);
  }

  if (samples.length === 0) {
    return { observed, ciLow: null, ciHigh: null, bootstrapSamples: 0 };
  }

  samples.sort((a, b) => a - b);
  const lowIdx = Math.floor(0.025 * (samples.length - 1));
  const highIdx = Math.floor(0.975 * (samples.length - 1));

  return { observed, ciLow: samples[lowIdx], ciHigh: samples[highIdx], bootstrapSamples: samples.length };
}
