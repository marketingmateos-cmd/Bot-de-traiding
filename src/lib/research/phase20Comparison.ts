import { correlation } from "@/lib/engines/riskEngine";
import { EDGE_COMPARISON_THRESHOLDS, MIN_SAMPLE_SIZE } from "./phase20PreRegistration";
import type { ReplayTradeRecord } from "@/lib/replay/types";

/**
 * Fase 20 — Comparación de edge incremental (spec Condiciones 7/8). For
 * ANY hypothesis reaching promising evidence, this module answers: is it
 * capturing something genuinely different from an existing strategy's
 * trades, or just the same effect restated? Two independent signals are
 * computed and combined via the FROZEN thresholds in
 * `EDGE_COMPARISON_THRESHOLDS` (chosen before any comparison ran, spec
 * Condición 14 — never re-tuned after seeing a result):
 *
 *  - Return correlation: trades from two strategies rarely share the same
 *    timestamps, so they can't be correlated pairwise directly. Instead
 *    each strategy's trades are bucketed into a DAILY realized-P&L series
 *    (summed by `exitTime`'s UTC date — the day the P&L was actually
 *    realized), the two series are aligned onto the union of their dates
 *    (missing days filled with 0, i.e. "no P&L that day"), and Pearson
 *    correlation (`correlation()`, reused unmodified from `riskEngine.ts`)
 *    is computed over that aligned pair.
 *  - Temporal overlap: the fraction of hypothesis-A trades whose
 *    [entryTime, exitTime] interval overlaps at least one hypothesis-B
 *    trade's interval — a direct, non-statistical measure of "were these
 *    two strategies actually in the market at the same time."
 *
 * Two strategies with BOTH high correlation AND high temporal overlap are
 * REDUNDANTE_MISMO_EFECTO; BOTH low is DISTINTA_INCREMENTAL; anything else
 * is PARCIALMENTE_DISTINTA (no strong claim either way) — deliberately
 * conservative, since Condición 9 forbids treating "not worse" as edge.
 */

export interface DailyPnlSeries {
  dates: string[];
  pnl: number[];
}

/** Buckets trades into a daily realized-P&L series, keyed by exitTime's UTC calendar date. */
export function buildDailyPnlSeries(trades: ReplayTradeRecord[]): DailyPnlSeries {
  const byDay = new Map<string, number>();
  for (const trade of trades) {
    const day = trade.exitTime.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + trade.netPnl);
  }
  const dates = Array.from(byDay.keys()).sort();
  return { dates, pnl: dates.map((d) => byDay.get(d) as number) };
}

/** Aligns two daily P&L series onto the union of their dates, filling missing days with 0. */
export function alignDailySeries(a: DailyPnlSeries, b: DailyPnlSeries): { datesUnion: string[]; aAligned: number[]; bAligned: number[] } {
  const datesUnion = Array.from(new Set([...a.dates, ...b.dates])).sort();
  const aMap = new Map(a.dates.map((d, i) => [d, a.pnl[i]]));
  const bMap = new Map(b.dates.map((d, i) => [d, b.pnl[i]]));
  return {
    datesUnion,
    aAligned: datesUnion.map((d) => aMap.get(d) ?? 0),
    bAligned: datesUnion.map((d) => bMap.get(d) ?? 0),
  };
}

/** Pearson correlation of two strategies' daily realized-P&L series, aligned by calendar date. Null when there are fewer than 3 overlapping-or-union days (same guard `correlation()` itself applies). */
export function computeReturnCorrelation(tradesA: ReplayTradeRecord[], tradesB: ReplayTradeRecord[]): number | null {
  const { aAligned, bAligned } = alignDailySeries(buildDailyPnlSeries(tradesA), buildDailyPnlSeries(tradesB));
  return correlation(aAligned, bAligned);
}

/** Fraction (0-1) of hypothesis-A trades whose [entryTime, exitTime] interval overlaps at least one hypothesis-B trade's interval. Returns 0 when A has no trades (nothing to check, never NaN/division-by-zero). */
export function computeTemporalOverlap(tradesA: ReplayTradeRecord[], tradesB: ReplayTradeRecord[]): number {
  if (tradesA.length === 0) return 0;
  let overlapping = 0;
  for (const a of tradesA) {
    const aStart = Date.parse(a.entryTime);
    const aEnd = Date.parse(a.exitTime);
    const hasOverlap = tradesB.some((b) => {
      const bStart = Date.parse(b.entryTime);
      const bEnd = Date.parse(b.exitTime);
      return aStart <= bEnd && bStart <= aEnd;
    });
    if (hasOverlap) overlapping++;
  }
  return overlapping / tradesA.length;
}

export type EdgeComparisonClassification = "REDUNDANTE_MISMO_EFECTO" | "PARCIALMENTE_DISTINTA" | "DISTINTA_INCREMENTAL" | "INSUFICIENTE_MUESTRA";

export interface EdgeComparisonResult {
  comparedAgainstStrategyId: string;
  tradeCountA: number;
  tradeCountB: number;
  returnCorrelation: number | null;
  temporalOverlap: number;
  classification: EdgeComparisonClassification;
}

/**
 * The full comparison for one hypothesis (`tradesA`) against one existing
 * strategy's trades (`tradesB`, identified by `comparedAgainstStrategyId`
 * only for reporting — this function never looks strategies up itself).
 * INSUFICIENTE_MUESTRA when either side is below `MIN_SAMPLE_SIZE` or the
 * correlation itself could not be computed — mirrors Fase 18's own
 * sample-size gating rather than inventing a new convention.
 */
export function compareHypothesisToStrategy(tradesA: ReplayTradeRecord[], tradesB: ReplayTradeRecord[], comparedAgainstStrategyId: string): EdgeComparisonResult {
  const returnCorrelation = computeReturnCorrelation(tradesA, tradesB);
  const temporalOverlap = computeTemporalOverlap(tradesA, tradesB);

  let classification: EdgeComparisonClassification;
  if (tradesA.length < MIN_SAMPLE_SIZE || tradesB.length < MIN_SAMPLE_SIZE || returnCorrelation === null) {
    classification = "INSUFICIENTE_MUESTRA";
  } else {
    const absCorr = Math.abs(returnCorrelation);
    if (absCorr >= EDGE_COMPARISON_THRESHOLDS.correlationHigh && temporalOverlap >= EDGE_COMPARISON_THRESHOLDS.temporalOverlapHigh) {
      classification = "REDUNDANTE_MISMO_EFECTO";
    } else if (absCorr <= EDGE_COMPARISON_THRESHOLDS.correlationLow && temporalOverlap <= EDGE_COMPARISON_THRESHOLDS.temporalOverlapLow) {
      classification = "DISTINTA_INCREMENTAL";
    } else {
      classification = "PARCIALMENTE_DISTINTA";
    }
  }

  return { comparedAgainstStrategyId, tradeCountA: tradesA.length, tradeCountB: tradesB.length, returnCorrelation, temporalOverlap, classification };
}
