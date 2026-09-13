import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";
import type { ReplayDataQualityReport } from "./types";

const TIMEFRAME_MS: Record<TimeframeCode, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

// Below this coverage, or with any future leakage, the replay is honestly
// unusable as evidence — block rather than produce a misleadingly-labeled
// result (spec Fase 7C: "Si hay problemas graves, el sistema debe advertir
// o bloquear el replay").
const MIN_COVERAGE_PCT_TO_RUN = 50;

/**
 * Fase 7C — Data Quality Report, evaluated once up front over the WHOLE
 * requested date range before a replay is allowed to run. Different from
 * (and a prerequisite for) `dataQuality.ts`'s per-bar-window score, which
 * the replay engine also runs at every decision point exactly like live
 * paper trading does — this one asks "is this series honest enough to
 * replay at all", not "is the market currently readable".
 */
export function evaluateHistoricalDataQuality(bars: OHLCVBar[], timeframe: TimeframeCode, rangeStart: Date, rangeEnd: Date): ReplayDataQualityReport {
  const warnings: string[] = [];
  const stepMs = TIMEFRAME_MS[timeframe];
  const totalBarsExpected = Math.max(1, Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / stepMs) + 1);

  if (bars.length === 0) {
    return {
      coveragePct: 0,
      missingCandlesPct: 100,
      duplicateTimestamps: 0,
      invalidCandles: 0,
      futureLeakage: 0,
      chronologyViolations: 0,
      totalBarsExpected,
      totalBarsPresent: 0,
      blocksReplay: true,
      warnings: ["No hay barras disponibles para el rango solicitado."],
    };
  }

  let duplicateTimestamps = 0;
  let invalidCandles = 0;
  let futureLeakage = 0;
  let chronologyViolations = 0;
  let missingCandles = 0;
  const seen = new Set<number>();
  const nowMs = Date.now();

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const t = bar.timestamp.getTime();

    if (seen.has(t)) duplicateTimestamps++;
    seen.add(t);

    // Zero look-ahead at the SOURCE: a bar timestamped after the replay's
    // own end date (or after real wall-clock "now", for a synthetic series
    // that leaked past the intended range) is future data leaking into a
    // series that will otherwise be consumed strictly chronologically.
    if (t > rangeEnd.getTime() || t > nowMs) futureLeakage++;

    if (i > 0) {
      const prevT = bars[i - 1].timestamp.getTime();
      if (t <= prevT) {
        chronologyViolations++;
      } else {
        const missing = Math.round((t - prevT) / stepMs) - 1;
        if (missing > 0) missingCandles += missing;
      }
    }

    const { open, high, low, close, volume } = bar;
    const positive = open > 0 && high > 0 && low > 0 && close > 0;
    const orderedHighLow = high >= low;
    const highIsMax = high >= Math.max(open, close);
    const lowIsMin = low <= Math.min(open, close);
    const validVolume = volume >= 0 && Number.isFinite(volume);
    if (!positive || !orderedHighLow || !highIsMax || !lowIsMin || !validVolume) invalidCandles++;
  }

  const totalBarsPresent = bars.length;
  const coveragePct = Math.min(100, (totalBarsPresent / totalBarsExpected) * 100);
  const missingCandlesPct = (missingCandles / totalBarsExpected) * 100;

  if (duplicateTimestamps > 0) warnings.push(`${duplicateTimestamps} timestamp(s) duplicado(s).`);
  if (chronologyViolations > 0) warnings.push(`${chronologyViolations} violación(es) de orden cronológico.`);
  if (invalidCandles > 0) warnings.push(`${invalidCandles} vela(s) con valores OHLCV imposibles.`);
  if (futureLeakage > 0) warnings.push(`${futureLeakage} barra(s) con fecha futura respecto al rango solicitado — posible fuga de datos futuros.`);
  if (coveragePct < MIN_COVERAGE_PCT_TO_RUN) warnings.push(`Cobertura del ${coveragePct.toFixed(1)}% — por debajo del mínimo del ${MIN_COVERAGE_PCT_TO_RUN}% para considerar el replay fiable.`);

  const blocksReplay = coveragePct < MIN_COVERAGE_PCT_TO_RUN || futureLeakage > 0 || chronologyViolations > 0;

  return {
    coveragePct,
    missingCandlesPct,
    duplicateTimestamps,
    invalidCandles,
    futureLeakage,
    chronologyViolations,
    totalBarsExpected,
    totalBarsPresent,
    blocksReplay,
    warnings,
  };
}
