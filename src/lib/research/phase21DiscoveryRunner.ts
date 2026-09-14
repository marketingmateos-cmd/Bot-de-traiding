import type { OHLCVBar } from "@/lib/providers/types";
import { atr, zScore } from "@/lib/engines/features";
import { detectRegime, type Regime } from "@/lib/engines/regime";
import { computeLogReturns, computeAutocorrelationWithBootstrapCI } from "@/lib/engines/edgeSignals/autocorrelation";
import { computeAtrPercentileRanks, computeCoilLength } from "@/lib/engines/edgeSignals/compression";
import { tagAsIsOnly } from "./phase21Discovery";
import { computeForwardReturns, computeTrailingReturns, computeForwardRealizedVol, computeTrailingPercentileRank, computeConditionalStats, bootstrapMeanCI, classifySignalEvidence, type ConditionalReturnStats, type BlockBootstrapCI, type SignalEvidence } from "./phase21EdgeStudy";
import {
  MIN_SAMPLE_SIZE,
  F21A_LAGS_HOURS,
  F21A_BOOTSTRAP_CONFIG,
  F21B_HORIZONS_HOURS,
  F21B_EXTREME_PERCENTILE,
  F21B_PERCENTILE_LOOKBACK,
  F21B_BOOTSTRAP_CONFIG,
  F21C_ATR_PERIOD,
  F21C_PERCENTILE_LOOKBACK,
  F21C_LOW_VOL_PERCENTILE,
  F21C_HIGH_VOL_PERCENTILE,
  F21C_FORWARD_HORIZONS_HOURS,
  F21C_BOOTSTRAP_CONFIG,
  F21D_BREAKOUT_LOOKBACK,
  F21D_VOLUME_ZSCORE_PERIOD,
  F21D_VOLUME_ZSCORE_THRESHOLD,
  F21D_LOW_VOLUME_RATIO,
  F21D_FORWARD_HORIZONS_HOURS,
  F21D_BOOTSTRAP_CONFIG,
  F21E_ATR_PERIOD,
  F21E_SQUEEZE_LOOKBACK,
  F21E_SQUEEZE_PERCENTILE,
  F21E_MIN_COIL_LENGTH,
  F21E_FORWARD_HORIZONS_HOURS,
  F21E_BOOTSTRAP_CONFIG,
} from "./phase21PreRegistration";

/**
 * Fase 21 — orquestación de Discovery (Condición: solo IS, nunca
 * VALIDATION/OOS). Cada `run*Discovery` acepta bars planos y los pasa por
 * `tagAsIsOnly` internamente — la barrera estructural se aplica siempre,
 * nunca se puede saltar llamando a estas funciones con bars fuera de rango.
 * `run*Segment` (sin barrera) se usa en Validation/OOS más adelante, sobre
 * exactamente la misma fórmula — nunca se reimplementa el cálculo dos
 * veces.
 */

export interface BucketResult {
  label: string;
  stats: ConditionalReturnStats;
  ci: BlockBootstrapCI;
  evidence: SignalEvidence;
  /** Bar indices (into the bars array passed to this run) that satisfied this bucket's condition — enables Family F to cross-tabulate the SAME events by regime, instead of the unconditional series. */
  indices: number[];
  /** The per-event return value actually used for stats/ci above (e.g. Family E's direction-adjusted forward return), parallel to `indices` — lets Family F reuse the exact same values instead of recomputing/guessing them. */
  values: number[];
}

// ── Familia A ─────────────────────────────────────────────────────────
export interface FamilyALagResult {
  lag: number;
  sampleSize: number;
  observed: number | null;
  ciLow: number | null;
  ciHigh: number | null;
}

function acfForLags(bars: OHLCVBar[]): FamilyALagResult[] {
  const closes = bars.map((b) => b.close);
  const returns = computeLogReturns(closes);
  return F21A_LAGS_HOURS.map((lag) => {
    const ci = computeAutocorrelationWithBootstrapCI(returns, lag, F21A_BOOTSTRAP_CONFIG);
    return { lag, sampleSize: returns.length, observed: ci.observed, ciLow: ci.ciLow, ciHigh: ci.ciHigh };
  });
}

export function runFamilyADiscovery(bars: OHLCVBar[]): FamilyALagResult[] {
  return acfForLags(tagAsIsOnly(bars));
}
export function runFamilyASegment(bars: OHLCVBar[]): FamilyALagResult[] {
  return acfForLags(bars);
}

// ── Familia B — Momentum / Reversión ────────────────────────────────────
function familyBForHorizon(bars: OHLCVBar[], horizon: number): BucketResult[] {
  const closes = bars.map((b) => b.close);
  const trailing = computeTrailingReturns(closes, horizon);
  const forward = computeForwardReturns(closes, horizon);
  const highReturns: number[] = [];
  const lowReturns: number[] = [];
  const highIndices: number[] = [];
  const lowIndices: number[] = [];
  for (let t = 0; t < closes.length; t++) {
    const rank = computeTrailingPercentileRank(trailing, t, F21B_PERCENTILE_LOOKBACK);
    const fwd = forward[t];
    if (rank === null || fwd === null) continue;
    if (rank >= 100 - F21B_EXTREME_PERCENTILE) {
      highReturns.push(fwd);
      highIndices.push(t);
    } else if (rank <= F21B_EXTREME_PERCENTILE) {
      lowReturns.push(fwd);
      lowIndices.push(t);
    }
  }
  const highStats = computeConditionalStats(highReturns);
  const highCI = bootstrapMeanCI(highReturns, F21B_BOOTSTRAP_CONFIG);
  const lowStats = computeConditionalStats(lowReturns);
  const lowCI = bootstrapMeanCI(lowReturns, F21B_BOOTSTRAP_CONFIG);
  return [
    { label: `h${horizon}_EXTREME_HIGH`, stats: highStats, ci: highCI, evidence: classifySignalEvidence(highStats, highCI, 1, MIN_SAMPLE_SIZE), indices: highIndices, values: highReturns },
    { label: `h${horizon}_EXTREME_LOW`, stats: lowStats, ci: lowCI, evidence: classifySignalEvidence(lowStats, lowCI, -1, MIN_SAMPLE_SIZE), indices: lowIndices, values: lowReturns },
  ];
}

function familyB(bars: OHLCVBar[]): BucketResult[] {
  return F21B_HORIZONS_HOURS.flatMap((h) => familyBForHorizon(bars, h));
}
export function runFamilyBDiscovery(bars: OHLCVBar[]): BucketResult[] {
  return familyB(tagAsIsOnly(bars));
}
export function runFamilyBSegment(bars: OHLCVBar[]): BucketResult[] {
  return familyB(bars);
}

// ── Familia C — Volatilidad ──────────────────────────────────────────────
export interface FamilyCBucketResult extends BucketResult {
  meanForwardVol: number | null;
}

function familyCForHorizon(bars: OHLCVBar[], horizon: number): FamilyCBucketResult[] {
  const closes = bars.map((b) => b.close);
  const atrArr = atr(bars, F21C_ATR_PERIOD);
  const forward = computeForwardReturns(closes, horizon);
  const lowReturns: number[] = [];
  const highReturns: number[] = [];
  const lowVols: number[] = [];
  const highVols: number[] = [];
  const lowIndices: number[] = [];
  const highIndices: number[] = [];
  for (let t = 0; t < closes.length; t++) {
    const rank = computeTrailingPercentileRank(atrArr, t, F21C_PERCENTILE_LOOKBACK);
    const fwd = forward[t];
    if (rank === null || fwd === null) continue;
    const fwdVol = computeForwardRealizedVol(closes, t, horizon);
    if (rank <= F21C_LOW_VOL_PERCENTILE) {
      lowReturns.push(fwd);
      lowIndices.push(t);
      if (fwdVol !== null) lowVols.push(fwdVol);
    } else if (rank >= F21C_HIGH_VOL_PERCENTILE) {
      highReturns.push(fwd);
      highIndices.push(t);
      if (fwdVol !== null) highVols.push(fwdVol);
    }
  }
  const mean = (arr: number[]) => (arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length);
  const lowStats = computeConditionalStats(lowReturns);
  const lowCI = bootstrapMeanCI(lowReturns, F21C_BOOTSTRAP_CONFIG);
  const highStats = computeConditionalStats(highReturns);
  const highCI = bootstrapMeanCI(highReturns, F21C_BOOTSTRAP_CONFIG);
  return [
    { label: `h${horizon}_LOW_VOL`, stats: lowStats, ci: lowCI, evidence: classifySignalEvidence(lowStats, lowCI, 1, MIN_SAMPLE_SIZE), meanForwardVol: mean(lowVols), indices: lowIndices, values: lowReturns },
    { label: `h${horizon}_HIGH_VOL`, stats: highStats, ci: highCI, evidence: classifySignalEvidence(highStats, highCI, 1, MIN_SAMPLE_SIZE), meanForwardVol: mean(highVols), indices: highIndices, values: highReturns },
  ];
}

function familyC(bars: OHLCVBar[]): FamilyCBucketResult[] {
  return F21C_FORWARD_HORIZONS_HOURS.flatMap((h) => familyCForHorizon(bars, h));
}
export function runFamilyCDiscovery(bars: OHLCVBar[]): FamilyCBucketResult[] {
  return familyC(tagAsIsOnly(bars));
}
export function runFamilyCSegment(bars: OHLCVBar[]): FamilyCBucketResult[] {
  return familyC(bars);
}

// ── Familia D — Precio + Volumen ─────────────────────────────────────────
function familyDForHorizon(bars: OHLCVBar[], horizon: number): BucketResult[] {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);
  const volZ = zScore(volumes, F21D_VOLUME_ZSCORE_PERIOD);
  const forward = computeForwardReturns(closes, horizon);

  const confirmedUp: number[] = [];
  const divergentUp: number[] = [];
  const confirmedDown: number[] = [];
  const divergentDown: number[] = [];
  const confirmedUpIdx: number[] = [];
  const divergentUpIdx: number[] = [];
  const confirmedDownIdx: number[] = [];
  const divergentDownIdx: number[] = [];

  for (let t = F21D_BREAKOUT_LOOKBACK; t < closes.length; t++) {
    const fwd = forward[t];
    if (fwd === null) continue;
    const windowHighs = highs.slice(t - F21D_BREAKOUT_LOOKBACK, t);
    const windowLows = lows.slice(t - F21D_BREAKOUT_LOOKBACK, t);
    const rangeHigh = Math.max(...windowHighs);
    const rangeLow = Math.min(...windowLows);
    const priorVolumes = volumes.slice(Math.max(0, t - F21D_VOLUME_ZSCORE_PERIOD), t);
    const meanPriorVol = priorVolumes.length > 0 ? priorVolumes.reduce((a, b) => a + b, 0) / priorVolumes.length : 0;
    const z = volZ[t];

    if (closes[t] > rangeHigh) {
      if (z !== null && z >= F21D_VOLUME_ZSCORE_THRESHOLD) {
        confirmedUp.push(fwd);
        confirmedUpIdx.push(t);
      } else if (meanPriorVol > 0 && volumes[t] / meanPriorVol < F21D_LOW_VOLUME_RATIO) {
        divergentUp.push(fwd);
        divergentUpIdx.push(t);
      }
    } else if (closes[t] < rangeLow) {
      if (z !== null && z >= F21D_VOLUME_ZSCORE_THRESHOLD) {
        confirmedDown.push(fwd);
        confirmedDownIdx.push(t);
      } else if (meanPriorVol > 0 && volumes[t] / meanPriorVol < F21D_LOW_VOLUME_RATIO) {
        divergentDown.push(fwd);
        divergentDownIdx.push(t);
      }
    }
  }

  const build = (label: string, sample: number[], expectedSign: 1 | -1, indices: number[]): BucketResult => {
    const stats = computeConditionalStats(sample);
    const ci = bootstrapMeanCI(sample, F21D_BOOTSTRAP_CONFIG);
    return { label, stats, ci, evidence: classifySignalEvidence(stats, ci, expectedSign, MIN_SAMPLE_SIZE), indices, values: sample };
  };

  return [
    build(`h${horizon}_BREAKOUT_UP_CONFIRMED`, confirmedUp, 1, confirmedUpIdx),
    build(`h${horizon}_BREAKOUT_UP_DIVERGENT`, divergentUp, 1, divergentUpIdx),
    build(`h${horizon}_BREAKOUT_DOWN_CONFIRMED`, confirmedDown, -1, confirmedDownIdx),
    build(`h${horizon}_BREAKOUT_DOWN_DIVERGENT`, divergentDown, -1, divergentDownIdx),
  ];
}

function familyD(bars: OHLCVBar[]): BucketResult[] {
  return F21D_FORWARD_HORIZONS_HOURS.flatMap((h) => familyDForHorizon(bars, h));
}
export function runFamilyDDiscovery(bars: OHLCVBar[]): BucketResult[] {
  return familyD(tagAsIsOnly(bars));
}
export function runFamilyDSegment(bars: OHLCVBar[]): BucketResult[] {
  return familyD(bars);
}

// ── Familia E — Compresión → Expansión ───────────────────────────────────
function familyEForHorizon(bars: OHLCVBar[], horizon: number): BucketResult[] {
  const closes = bars.map((b) => b.close);
  const ranks = computeAtrPercentileRanks(bars, F21E_ATR_PERIOD, F21E_SQUEEZE_LOOKBACK);
  const atrArr = atr(bars, F21E_ATR_PERIOD);
  const forward = computeForwardReturns(closes, horizon);

  const shortCoil: number[] = [];
  const longCoil: number[] = [];
  const shortCoilIdx: number[] = [];
  const longCoilIdx: number[] = [];

  for (let t = 1; t < bars.length; t++) {
    const currentAtr = atrArr[t];
    const fwd = forward[t];
    if (currentAtr === null || currentAtr <= 0 || fwd === null) continue;
    const currentRange = bars[t].high - bars[t].low;
    const isExpansion = currentRange > 1.3 * currentAtr; // mismo expansionMultiplier que F17-A/F20-E
    if (!isExpansion) continue;
    const coilLen = computeCoilLength(ranks, t - 1, F21E_SQUEEZE_PERCENTILE);
    if (coilLen === 0) continue; // no hubo compresión previa — no es el evento que esta familia estudia
    const direction = closes[t] >= closes[t - 1] ? 1 : -1;
    const directionalFwd = direction * fwd;
    if (coilLen < F21E_MIN_COIL_LENGTH) {
      shortCoil.push(directionalFwd);
      shortCoilIdx.push(t);
    } else {
      longCoil.push(directionalFwd);
      longCoilIdx.push(t);
    }
  }

  const build = (label: string, sample: number[], indices: number[]): BucketResult => {
    const stats = computeConditionalStats(sample);
    const ci = bootstrapMeanCI(sample, F21E_BOOTSTRAP_CONFIG);
    // directionalFwd ya está alineado con la dirección de la ruptura — bajo la hipótesis de continuación, se espera positivo.
    return { label, stats, ci, evidence: classifySignalEvidence(stats, ci, 1, MIN_SAMPLE_SIZE), indices, values: sample };
  };

  return [build(`h${horizon}_SHORT_COIL`, shortCoil, shortCoilIdx), build(`h${horizon}_LONG_COIL`, longCoil, longCoilIdx)];
}

function familyE(bars: OHLCVBar[]): BucketResult[] {
  return F21E_FORWARD_HORIZONS_HOURS.flatMap((h) => familyEForHorizon(bars, h));
}
export function runFamilyEDiscovery(bars: OHLCVBar[]): BucketResult[] {
  return familyE(tagAsIsOnly(bars));
}
export function runFamilyESegment(bars: OHLCVBar[]): BucketResult[] {
  return familyE(bars);
}

// ── Familia F — Regímenes (cruce transversal) ────────────────────────────
export interface RegimeCell {
  regime: Regime;
  n: number;
  meanForward: number | null;
  insufficientSample: boolean;
}

/**
 * Precalcula el régimen vigente en CADA índice de la serie, UNA sola vez
 * por activo — reutiliza `detectRegime` sin modificarlo. Family F cruza
 * potencialmente muchos buckets (B/C/D/E × horizontes) contra el mismo
 * activo; recalcular `detectRegime(bars.slice(0, t+1))` (O(t) cada vez)
 * por separado para cada bucket sería redundante en el mismo trabajo
 * O(n²) una y otra vez. Calculado aquí una única vez y reutilizado como
 * lookup por `stratifyByRegime` para cualquier número de buckets.
 */
export function computeRegimeSeries(bars: OHLCVBar[]): (Regime | null)[] {
  const regimes: (Regime | null)[] = new Array(bars.length).fill(null);
  for (let t = 60; t < bars.length; t++) {
    // detectRegime necesita >=60 bars para no caer en su fallback de baja confianza (TRANSITION).
    regimes[t] = detectRegime(bars.slice(0, t + 1)).regime;
  }
  return regimes;
}

/**
 * Estratifica un conjunto YA CALCULADO de (índice, retornoFuturo) por el
 * régimen vigente en ese índice, usando una serie de régimen YA
 * PRECALCULADA (`computeRegimeSeries`) — nunca recalcula `detectRegime`
 * por sí misma. Nunca declara una celda con n < minSampleSize.
 */
export function stratifyByRegime(regimeSeries: (Regime | null)[], indices: number[], forwardReturns: (number | null)[], minSampleSize = MIN_SAMPLE_SIZE): RegimeCell[] {
  const byRegime = new Map<Regime, number[]>();
  for (const t of indices) {
    const fwd = forwardReturns[t];
    const regime = regimeSeries[t];
    if (fwd === null || regime === null) continue;
    if (!byRegime.has(regime)) byRegime.set(regime, []);
    byRegime.get(regime)!.push(fwd);
  }
  return Array.from(byRegime.entries()).map(([regime, values]) => {
    const n = values.length;
    return { regime, n, meanForward: n > 0 ? values.reduce((a, b) => a + b, 0) / n : null, insufficientSample: n < minSampleSize };
  });
}

/**
 * Family F on a SPECIFIC bucket's own events (not the unconditional series at that
 * horizon) — takes a `BucketResult` straight from Family B/C/D/E and cross-tabulates
 * exactly the events that satisfied that bucket's condition, using the exact same
 * per-event values (`bucket.values`, e.g. Family E's direction-adjusted forward
 * return) rather than recomputing/guessing an unconditional forward-return series.
 */
export function stratifyBucketByRegime(regimeSeries: (Regime | null)[], bucket: BucketResult, minSampleSize = MIN_SAMPLE_SIZE): RegimeCell[] {
  const sparse: (number | null)[] = new Array(regimeSeries.length).fill(null);
  bucket.indices.forEach((t, i) => {
    sparse[t] = bucket.values[i];
  });
  return stratifyByRegime(regimeSeries, bucket.indices, sparse, minSampleSize);
}
