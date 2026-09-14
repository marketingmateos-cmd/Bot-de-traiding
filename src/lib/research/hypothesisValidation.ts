import type { Regime } from "@/lib/engines/regime";
import type { ReplayDecisionRecord, ReplayTradeRecord } from "@/lib/replay/types";
import { attachRegimeToTrades, computeBucketStats, MIN_SAMPLE_SIZE, type BucketStats, type EnrichedTrade, type VolatilityBucket } from "./regimeAnalysis";

/**
 * Fase 13 — Hypothesis Validation & Walk-Forward. Pure post-processing,
 * exactly like `regimeAnalysis.ts` (Fase 12): every function here takes
 * ALREADY-simulated trades/decisions for one or more temporal segments and
 * asks one question — "does a Fase 12 hypothesis hold up OUTSIDE the
 * segment where it was first observed?" Nothing here re-runs a strategy
 * with different parameters, chooses a winner, or filters trades. The
 * segments themselves are produced by the EXISTING (Fase 7D)
 * `runIsValidationOosReplay` — this module never re-implements replay or
 * regime detection, only compares groups of already-attributed trades.
 */

export type SegmentLabel = "OOS" | "VALIDATION" | "IS";

/** Deliberately OOS-first (spec section 10) — every list/table iterates in this order so a reader never anchors on the training segment first. */
export const SEGMENT_ORDER: SegmentLabel[] = ["OOS", "VALIDATION", "IS"];

export interface SegmentRange {
  start: Date;
  end: Date;
}

export interface IsValidationOosRangesWithLabels {
  is: SegmentRange;
  validation: SegmentRange;
  oos: SegmentRange;
}

const DAY_MS = 24 * 60 * 60_000;
const MIN_TOTAL_DAYS_FOR_SEGMENTS = 30;

/** Same 60/20/20 chronological split convention as Fase 12's stability-check and HistoricalReplayForm.tsx — not re-derived per caller. Returns null when the range is too short to segment meaningfully (never fabricates segments). */
export function computeIsValidationOosRanges(start: Date, end: Date): IsValidationOosRangesWithLabels | null {
  const totalDays = (end.getTime() - start.getTime()) / DAY_MS;
  if (totalDays < MIN_TOTAL_DAYS_FOR_SEGMENTS) return null;
  const isEnd = new Date(start.getTime() + totalDays * 0.6 * DAY_MS);
  const validationEnd = new Date(start.getTime() + totalDays * 0.8 * DAY_MS);
  return {
    is: { start, end: isEnd },
    validation: { start: new Date(isEnd.getTime() + 3_600_000), end: validationEnd },
    oos: { start: new Date(validationEnd.getTime() + 3_600_000), end },
  };
}

const H1_CANDLE_MS = 3_600_000; // spec section 21 — this phase works exclusively with the existing H1 dataset, never a new timeframe

/** Documentation-only estimate (spec section 3: "Documentar exactamente start/end/candles/trades") — the actual candle count a replay used comes from its own data-quality report; this is the calendar-implied count for display next to it. */
export function estimateCandleCount(range: SegmentRange): number {
  return Math.max(0, Math.round((range.end.getTime() - range.start.getTime()) / H1_CANDLE_MS) + 1);
}

export type ComparisonDirection = "LOWER" | "HIGHER";

export interface GroupComparison {
  inGroup: BucketStats;
  outGroup: BucketStats;
  /** null when the hypothesis subgroup itself has an insufficient sample (spec sections 7/8: n < MIN_SAMPLE_SIZE) — the segment is then simply not evaluable, never coerced into a direction. */
  directionSupported: boolean | null;
}

/**
 * The one comparison primitive every hypothesis in this module reduces to:
 * split already-regime-attributed trades into a subgroup and its
 * complement, and ask whether the subgroup's expectancy is LOWER or HIGHER
 * than the complement's — exactly the direction the corresponding Fase 12
 * hypothesis claimed. Evaluability requires only the IN-group to clear
 * MIN_SAMPLE_SIZE (the spec's own wording: "marcar INSUFFICIENT SAMPLE si
 * n < 20" refers to the hypothesis subgroup, e.g. BEAR trades) — the
 * out-group (e.g. NON-BEAR) is virtually always large enough on this
 * dataset, but its own `insufficientSample` flag is still returned
 * untouched for the caller to see.
 */
export function compareGroups(enriched: EnrichedTrade[], predicate: (e: EnrichedTrade) => boolean, direction: ComparisonDirection): GroupComparison {
  const inGroup = computeBucketStats(enriched.filter(predicate));
  const outGroup = computeBucketStats(enriched.filter((e) => !predicate(e)));
  const directionSupported = inGroup.insufficientSample ? null : direction === "LOWER" ? inGroup.expectancy < outGroup.expectancy : inGroup.expectancy > outGroup.expectancy;
  return { inGroup, outGroup, directionSupported };
}

export const isRangeRegime = (e: EnrichedTrade): boolean => e.regime === "RANGE";
export const isHighVolatilityRegime = (e: EnrichedTrade): boolean => e.regime === "HIGH_VOLATILITY";
export const isBearRegime = (e: EnrichedTrade): boolean => e.regime === "BEAR";

export type HypothesisStatus = "SUPPORTED" | "WEAK" | "REJECTED" | "INCONCLUSIVE";

export interface HypothesisSegmentResult {
  segment: SegmentLabel;
  range: SegmentRange;
  candles: number;
  comparison: GroupComparison;
}

export interface SegmentedTradeData {
  label: SegmentLabel;
  range: SegmentRange;
  trades: ReplayTradeRecord[];
  decisions: ReplayDecisionRecord[];
}

export interface HypothesisResult {
  id: string;
  description: string;
  strategyId: string;
  strategyName: string;
  direction: ComparisonDirection;
  /** Always length 3, ordered OOS, VALIDATION, IS. */
  segments: HypothesisSegmentResult[];
  evaluableSegments: number;
  supportingSegments: number;
  stabilityScore: number | null;
  status: HypothesisStatus;
}

/**
 * Spec section 11 — a purely descriptive stability score, never fed back
 * into any strategy or used to pick a winner: the fraction of evaluable
 * segments (IS/VALIDATION/OOS, each requiring the hypothesis subgroup to
 * clear MIN_SAMPLE_SIZE) whose expectancy comparison agrees with the
 * direction the hypothesis originally claimed.
 */
export const STABILITY_SCORE_FORMULA =
  "stabilityScore = supportingSegments / evaluableSegments, computed only over segments (of IS/VALIDATION/OOS) where the hypothesis subgroup has trades >= MIN_SAMPLE_SIZE (20). A segment where the subgroup is too small is excluded from both counts, never scored as failing. Descriptive only — never used to select, tune, or filter a strategy.";

/**
 * Spec section 12 — SUPPORTED requires the effect to show up consistently
 * (every evaluable segment agrees) AND to include at least 2 evaluable
 * segments AND for OOS specifically to be evaluable and agree — a single
 * evaluable segment, even if it supports the direction, is only WEAK,
 * since "consistent outside the original segment" cannot be shown from one
 * data point. REJECTED requires every evaluable segment to contradict the
 * direction. Anything else with at least one evaluable segment is WEAK.
 * Zero evaluable segments anywhere is INCONCLUSIVE.
 */
export function classifyHypothesisStatus(segments: HypothesisSegmentResult[]): { status: HypothesisStatus; evaluableSegments: number; supportingSegments: number; stabilityScore: number | null } {
  const evaluable = segments.filter((s) => s.comparison.directionSupported !== null);
  if (evaluable.length === 0) {
    return { status: "INCONCLUSIVE", evaluableSegments: 0, supportingSegments: 0, stabilityScore: null };
  }
  const supporting = evaluable.filter((s) => s.comparison.directionSupported === true);
  const stabilityScore = supporting.length / evaluable.length;
  const oos = segments.find((s) => s.segment === "OOS");

  let status: HypothesisStatus;
  if (supporting.length === 0) {
    status = "REJECTED";
  } else if (supporting.length === evaluable.length && evaluable.length >= 2 && oos?.comparison.directionSupported === true) {
    status = "SUPPORTED";
  } else {
    status = "WEAK";
  }
  return { status, evaluableSegments: evaluable.length, supportingSegments: supporting.length, stabilityScore };
}

export function buildHypothesisResult(
  id: string,
  description: string,
  strategyId: string,
  strategyName: string,
  direction: ComparisonDirection,
  predicate: (e: EnrichedTrade) => boolean,
  segmentedData: SegmentedTradeData[]
): HypothesisResult {
  const segments: HypothesisSegmentResult[] = SEGMENT_ORDER.map((label) => {
    const data = segmentedData.find((s) => s.label === label);
    if (!data) throw new Error(`buildHypothesisResult: missing segment data for "${label}".`);
    const enriched = attachRegimeToTrades(data.trades, data.decisions);
    const comparison = compareGroups(enriched, predicate, direction);
    return { segment: label, range: data.range, candles: estimateCandleCount(data.range), comparison };
  });
  const { status, evaluableSegments, supportingSegments, stabilityScore } = classifyHypothesisStatus(segments);
  return { id, description, strategyId, strategyName, direction, segments, evaluableSegments, supportingSegments, stabilityScore, status };
}

// ── H5: common-market-event analysis (spec section 9) ──────────────────

export interface MarketEventTrade {
  strategyId: string;
  strategyName: string;
  entryTime: string;
  exitTime: string;
  netPnl: number;
  rMultiple: number | null;
  regime: Regime | null;
  volatilityBucket: VolatilityBucket;
  exitReason: string;
  /** entryPrice × quantity — a notional-exposure proxy. `ReplayTradeRecord` has no separate per-trade "exposure %" field (that's only tracked as a run-level max/avg in `ReplayMetrics`), so this is the closest honest per-trade measure and is labeled as such. */
  notionalExposure: number;
}

export interface MarketEventStrategySummary {
  strategyId: string;
  strategyName: string;
  tradesOverlapping: number;
  totalPnl: number;
  losses: number;
  avgRMultiple: number | null;
  regimesSeen: string[];
  volatilityBucketsSeen: VolatilityBucket[];
}

export type MarketEventClassification = "COMMON_MARKET_EVENT" | "STRATEGY_SPECIFIC" | "MIXED" | "NO_OVERLAP";

export interface MarketEventAnalysis {
  eventStart: string;
  eventEnd: string;
  trades: MarketEventTrade[];
  byStrategy: MarketEventStrategySummary[];
  strategiesAffected: number;
  totalStrategies: number;
  allAffectedNegative: boolean;
  classification: MarketEventClassification;
  /** H5 framed as "this was a common market event, not a strategy-specific one" — SUPPORTED only when every strategy in the run has an overlapping trade AND every affected strategy lost money in the window. */
  status: HypothesisStatus;
}

/**
 * Spec section 9 — a trade "overlaps" the event window if its open
 * interval [entryTime, exitTime] intersects [eventStart, eventEnd] at all
 * (not just entries strictly inside it), since a position opened just
 * before the event and closed during it was still exposed to the event.
 */
export function analyzeMarketEvent(
  perStrategy: { strategyId: string; strategyName: string; trades: ReplayTradeRecord[]; decisions: ReplayDecisionRecord[] }[],
  eventStart: Date,
  eventEnd: Date
): MarketEventAnalysis {
  const allTrades: MarketEventTrade[] = [];
  const byStrategy: MarketEventStrategySummary[] = [];

  for (const s of perStrategy) {
    const enriched = attachRegimeToTrades(s.trades, s.decisions);
    const overlapping = enriched.filter((e) => {
      const entry = new Date(e.trade.entryTime).getTime();
      const exit = new Date(e.trade.exitTime).getTime();
      return entry <= eventEnd.getTime() && exit >= eventStart.getTime();
    });

    for (const e of overlapping) {
      allTrades.push({
        strategyId: s.strategyId,
        strategyName: s.strategyName,
        entryTime: e.trade.entryTime,
        exitTime: e.trade.exitTime,
        netPnl: e.trade.netPnl,
        rMultiple: e.rMultiple,
        regime: e.regime,
        volatilityBucket: e.volatilityBucket,
        exitReason: e.trade.exitReason,
        notionalExposure: e.trade.entryPrice * e.trade.quantity,
      });
    }

    const totalPnl = overlapping.reduce((sum, e) => sum + e.trade.netPnl, 0);
    const losses = overlapping.filter((e) => e.trade.netPnl <= 0).length;
    const rMultiples = overlapping.map((e) => e.rMultiple).filter((r): r is number => r !== null);
    const avgRMultiple = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null;

    byStrategy.push({
      strategyId: s.strategyId,
      strategyName: s.strategyName,
      tradesOverlapping: overlapping.length,
      totalPnl,
      losses,
      avgRMultiple,
      regimesSeen: Array.from(new Set(overlapping.map((e) => e.regime ?? "UNKNOWN"))),
      volatilityBucketsSeen: Array.from(new Set(overlapping.map((e) => e.volatilityBucket))),
    });
  }

  const affected = byStrategy.filter((s) => s.tradesOverlapping > 0);
  const strategiesAffected = affected.length;
  const totalStrategies = perStrategy.length;
  const allAffectedNegative = affected.length > 0 && affected.every((s) => s.totalPnl < 0);

  let classification: MarketEventClassification;
  let status: HypothesisStatus;
  if (strategiesAffected === 0) {
    classification = "NO_OVERLAP";
    status = "INCONCLUSIVE";
  } else if (strategiesAffected === totalStrategies && allAffectedNegative) {
    classification = "COMMON_MARKET_EVENT";
    status = "SUPPORTED";
  } else if (strategiesAffected <= 1) {
    classification = "STRATEGY_SPECIFIC";
    status = "REJECTED";
  } else {
    classification = "MIXED";
    status = "WEAK";
  }

  return {
    eventStart: eventStart.toISOString(),
    eventEnd: eventEnd.toISOString(),
    trades: allTrades,
    byStrategy,
    strategiesAffected,
    totalStrategies,
    allAffectedNegative,
    classification,
    status,
  };
}

// ── Supplementary walk-forward (spec section 4) ─────────────────────────

/**
 * Fixed, documented parameters for the supplementary walk-forward check —
 * chosen (not tuned) to fit 2-3 non-degenerate windows inside the dataset's
 * 184-day range while leaving each window's own train/test split
 * (`trainFraction`) at the SAME 0.7 default `HistoricalReplayForm.tsx`
 * already uses elsewhere in this codebase.
 */
export const SUPPLEMENTARY_WALK_FORWARD_OPTIONS = { windowSizeDays: 90, trainFraction: 0.7, stepDays: 45 };

/**
 * Spec section 4's own explicit instruction: "si seis meses no permiten un
 * número estadísticamente útil de ventanas, decirlo claramente. No
 * fabricar robustez." A ~90-day window's own OOS/test portion is ~27 days
 * (30% of 90) — about 15% of the full 184-day range. Subdividing THAT
 * further by regime (RANGE/BEAR/HIGH_VOLATILITY) would push most cells
 * well under MIN_SAMPLE_SIZE for every strategy. Rather than fabricate a
 * regime-level walk-forward this dataset cannot support, this check
 * reports only the existing (Fase 7E) aggregate train/OOS return/PF/trade
 * count per window — a coarser, non-regime-specific stability signal.
 */
export const WALK_FORWARD_LIMITATION_NOTE =
  "Walk-forward windows below report overall return/PF/trade count per window only — NOT decomposed by regime. Each ~90-day window's own OOS/test portion is only ~27 days (~15% of the full 184-day dataset); subdividing that further by regime would push most cells well under MIN_SAMPLE_SIZE (20) for every strategy. Reporting a fabricated regime-level walk-forward would misrepresent the dataset's actual statistical power, so this check intentionally stays at the aggregate level.";
