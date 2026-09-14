import type { Regime } from "@/lib/engines/regime";
import type { ReplayDecisionRecord, ReplayTradeRecord } from "@/lib/replay/types";

/**
 * Fase 12 — Regime-Aware Strategy Research. Pure post-processing over data
 * a benchmark run (Fase 11) ALREADY persisted — never a second Regime
 * Engine, never a re-run of the replay. Every `ReplayTradeRecord` carries
 * `decisionIndex`, pointing at the EXACT `ReplayDecisionRecord` that opened
 * it — the same tick, same `detectRegime()` call, same causal window
 * (`barsAsOf`) the live pipeline already used. Joining through that index
 * is therefore "regime at signal/entry time" BY CONSTRUCTION: there is no
 * code path here that could attach a later regime to an earlier trade.
 *
 * `volatilityBucket` below is a NEW, deliberately simple classification —
 * distinct from (though derived from the same causal
 * `detectRegime().details.volatilityPercentile` input as) the Regime
 * Engine's own HIGH_VOLATILITY/LOW_VOLATILITY regime values, which only
 * fire in the ~12% percentile tails and are mutually exclusive with every
 * trend/range regime. This gives a THIRD axis (volatility bucket) that can
 * be read alongside the regime label instead of instead of it — spec
 * section 5: "Si no existe una clasificación discreta: crear una
 * clasificación simple y documentada basada únicamente en información
 * disponible antes de la entrada."
 */

export type VolatilityBucket = "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";

/** Terciles of the trailing-history volatility percentile already computed by detectRegime() — <25th LOW, >75th HIGH, else NORMAL. UNKNOWN only for a decision predating Fase 12's persisted field. */
export function computeVolatilityBucket(volatilityPercentile: number | null | undefined): VolatilityBucket {
  if (volatilityPercentile === null || volatilityPercentile === undefined) return "UNKNOWN";
  if (volatilityPercentile < 25) return "LOW";
  if (volatilityPercentile > 75) return "HIGH";
  return "NORMAL";
}

/** Spec section 10 — the ONE shared minimum-sample threshold applied everywhere a per-bucket stat is computed, so no cell can quietly read as significant on a handful of trades. */
export const MIN_SAMPLE_SIZE = 20;

export interface EnrichedTrade {
  trade: ReplayTradeRecord;
  regime: Regime | null;
  volatilityPercentile: number | null;
  volatilityBucket: VolatilityBucket;
  direction: "LONG" | "SHORT";
  entryHourUtc: number;
  /** 0=Sunday..6=Saturday, per Date.prototype.getUTCDay(). */
  entryWeekday: number;
  /** netPnl / riskAmount, where riskAmount = |entryPrice - stopLoss| × quantity. Null when the trade predates Fase 11's per-trade stopLoss capture, or the stop distance was zero. */
  rMultiple: number | null;
  holdingTimeHours: number;
}

/**
 * The one join point. `decisions` MUST be the same run's own decisions
 * array (indices are only meaningful within one replay). A trade whose
 * `decisionIndex` is out of range (should never happen for a run produced
 * by this codebase, but never trusted blindly) gets `regime: null` rather
 * than throwing.
 */
export function attachRegimeToTrades(trades: ReplayTradeRecord[], decisions: ReplayDecisionRecord[]): EnrichedTrade[] {
  return trades.map((trade) => {
    const decision: ReplayDecisionRecord | undefined = decisions[trade.decisionIndex];
    const volatilityPercentile = decision?.volatilityPercentile ?? null;
    const entryDate = new Date(trade.entryTime);

    const riskAmount = trade.stopLoss !== null && trade.stopLoss !== undefined ? Math.abs(trade.entryPrice - trade.stopLoss) * trade.quantity : 0;
    const rMultiple = riskAmount > 0 ? trade.netPnl / riskAmount : null;

    return {
      trade,
      regime: decision?.regime ?? null,
      volatilityPercentile,
      volatilityBucket: computeVolatilityBucket(volatilityPercentile),
      direction: trade.direction,
      entryHourUtc: entryDate.getUTCHours(),
      entryWeekday: entryDate.getUTCDay(),
      rMultiple,
      holdingTimeHours: (new Date(trade.exitTime).getTime() - entryDate.getTime()) / 3_600_000,
    };
  });
}

export interface BucketStats {
  trades: number;
  winRate: number;
  totalPnl: number;
  expectancy: number;
  profitFactor: number | null;
  avgTrade: number;
  /** Peak-to-trough of THIS subset's own chronological cumulative-P&L sequence, in isolation — NOT the full portfolio's drawdown (which reflects every trade, not just this bucket's). */
  maxDrawdown: number;
  longestLossStreak: number;
  avgHoldingTimeHours: number;
  /** Spec section 10 — true when `trades < MIN_SAMPLE_SIZE`. The stats above are still computed (never omitted), just flagged: a caller decides whether to gray them out, never this function. */
  insufficientSample: boolean;
}

export function computeBucketStats(enrichedTrades: EnrichedTrade[]): BucketStats {
  const trades = enrichedTrades.map((e) => e.trade);
  const n = trades.length;
  if (n === 0) {
    return { trades: 0, winRate: 0, totalPnl: 0, expectancy: 0, profitFactor: null, avgTrade: 0, maxDrawdown: 0, longestLossStreak: 0, avgHoldingTimeHours: 0, insufficientSample: true };
  }

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss;

  const chronological = [...trades].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let curLossStreak = 0;
  let longestLossStreak = 0;
  for (const t of chronological) {
    cumulative += t.netPnl;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    if (t.netPnl <= 0) {
      curLossStreak++;
      longestLossStreak = Math.max(longestLossStreak, curLossStreak);
    } else {
      curLossStreak = 0;
    }
  }

  const avgHoldingTimeHours = enrichedTrades.reduce((s, e) => s + e.holdingTimeHours, 0) / n;

  return {
    trades: n,
    winRate: wins.length / n,
    totalPnl,
    expectancy: totalPnl / n,
    profitFactor,
    avgTrade: totalPnl / n,
    maxDrawdown,
    longestLossStreak,
    avgHoldingTimeHours,
    insufficientSample: n < MIN_SAMPLE_SIZE,
  };
}

function groupBy<K extends string | number>(items: EnrichedTrade[], keyFn: (t: EnrichedTrade) => K): Map<K, EnrichedTrade[]> {
  const map = new Map<K, EnrichedTrade[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function statsByGroup<K extends string | number>(items: EnrichedTrade[], keyFn: (t: EnrichedTrade) => K): Record<string, BucketStats> {
  const grouped = groupBy(items, keyFn);
  const out: Record<string, BucketStats> = {};
  for (const [key, trades] of grouped) out[String(key)] = computeBucketStats(trades);
  return out;
}

export interface LossAnalysisTrade {
  entryTime: string;
  exitTime: string;
  netPnl: number;
  rMultiple: number | null;
  regime: Regime | null;
  volatilityBucket: VolatilityBucket;
  exitReason: string;
}

export interface LossAnalysis {
  /** The N worst trades by netPnl, most negative first. */
  largestLosses: LossAnalysisTrade[];
  /** Losing-streak LENGTH -> how many times a streak of exactly that length occurred (chronological, across all trades). */
  losingStreakDistribution: Record<number, number>;
  maxLosingStreak: number;
  avgRMultiple: number | null;
  medianRMultiple: number | null;
  /** Count of LOSING trades (netPnl <= 0) per regime — a raw count, not a rate; cross-reference against `byRegime` for the denominator. */
  lossesByRegime: Record<string, number>;
  lossesByVolatility: Record<string, number>;
}

const LARGEST_LOSSES_COUNT = 10;

export function computeLossAnalysis(enrichedTrades: EnrichedTrade[]): LossAnalysis {
  const losses = enrichedTrades.filter((e) => e.trade.netPnl <= 0);

  const largestLosses = [...losses]
    .sort((a, b) => a.trade.netPnl - b.trade.netPnl)
    .slice(0, LARGEST_LOSSES_COUNT)
    .map((e) => ({
      entryTime: e.trade.entryTime,
      exitTime: e.trade.exitTime,
      netPnl: e.trade.netPnl,
      rMultiple: e.rMultiple,
      regime: e.regime,
      volatilityBucket: e.volatilityBucket,
      exitReason: e.trade.exitReason,
    }));

  const chronological = [...enrichedTrades].sort((a, b) => new Date(a.trade.exitTime).getTime() - new Date(b.trade.exitTime).getTime());
  const losingStreakDistribution: Record<number, number> = {};
  let curStreak = 0;
  let maxLosingStreak = 0;
  for (const e of chronological) {
    if (e.trade.netPnl <= 0) {
      curStreak++;
    } else if (curStreak > 0) {
      losingStreakDistribution[curStreak] = (losingStreakDistribution[curStreak] ?? 0) + 1;
      maxLosingStreak = Math.max(maxLosingStreak, curStreak);
      curStreak = 0;
    }
  }
  if (curStreak > 0) {
    losingStreakDistribution[curStreak] = (losingStreakDistribution[curStreak] ?? 0) + 1;
    maxLosingStreak = Math.max(maxLosingStreak, curStreak);
  }

  const rMultiples = enrichedTrades.map((e) => e.rMultiple).filter((r): r is number => r !== null);
  const avgRMultiple = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null;
  const sortedR = [...rMultiples].sort((a, b) => a - b);
  const medianRMultiple = sortedR.length > 0 ? (sortedR.length % 2 === 1 ? sortedR[(sortedR.length - 1) / 2] : (sortedR[sortedR.length / 2 - 1] + sortedR[sortedR.length / 2]) / 2) : null;

  const lossesByRegime: Record<string, number> = {};
  const lossesByVolatility: Record<string, number> = {};
  for (const e of losses) {
    const regimeKey = e.regime ?? "UNKNOWN";
    lossesByRegime[regimeKey] = (lossesByRegime[regimeKey] ?? 0) + 1;
    lossesByVolatility[e.volatilityBucket] = (lossesByVolatility[e.volatilityBucket] ?? 0) + 1;
  }

  return { largestLosses, losingStreakDistribution, maxLosingStreak, avgRMultiple, medianRMultiple, lossesByRegime, lossesByVolatility };
}

export interface ExitReasonStats {
  count: number;
  totalPnl: number;
  avgPnl: number;
}

export interface ExitAnalysis {
  byExitReason: Record<string, ExitReasonStats>;
  /** exitReason -> regime -> count. A high STOP_LOSS count concentrated in one regime is a hint (never a conclusion — section 8: "no cambiar todavía SL/TP, solo medir") about entries fighting that regime. */
  byExitReasonAndRegime: Record<string, Record<string, number>>;
}

export function computeExitAnalysis(enrichedTrades: EnrichedTrade[]): ExitAnalysis {
  const byExitReason: Record<string, ExitReasonStats> = {};
  const byExitReasonAndRegime: Record<string, Record<string, number>> = {};

  for (const e of enrichedTrades) {
    const reason = e.trade.exitReason;
    const stats = byExitReason[reason] ?? { count: 0, totalPnl: 0, avgPnl: 0 };
    stats.count += 1;
    stats.totalPnl += e.trade.netPnl;
    stats.avgPnl = stats.totalPnl / stats.count;
    byExitReason[reason] = stats;

    const regimeKey = e.regime ?? "UNKNOWN";
    const regimeCounts = byExitReasonAndRegime[reason] ?? {};
    regimeCounts[regimeKey] = (regimeCounts[regimeKey] ?? 0) + 1;
    byExitReasonAndRegime[reason] = regimeCounts;
  }

  return { byExitReason, byExitReasonAndRegime };
}

export interface RegimeAnalysis {
  totalTrades: number;
  byRegime: Record<string, BucketStats>;
  byDirection: Record<string, BucketStats>;
  byVolatility: Record<string, BucketStats>;
  byHourUtc: Record<string, BucketStats>;
  byWeekday: Record<string, BucketStats>;
  lossAnalysis: LossAnalysis;
  exitAnalysis: ExitAnalysis;
}

/** The one entry point a caller (API route) needs — joins, then computes every section-3/4/5/6/7/8 breakdown in one pass. */
export function computeRegimeAnalysis(trades: ReplayTradeRecord[], decisions: ReplayDecisionRecord[]): RegimeAnalysis {
  const enriched = attachRegimeToTrades(trades, decisions);

  return {
    totalTrades: enriched.length,
    byRegime: statsByGroup(enriched, (e) => e.regime ?? "UNKNOWN"),
    byDirection: statsByGroup(enriched, (e) => e.direction),
    byVolatility: statsByGroup(enriched, (e) => e.volatilityBucket),
    byHourUtc: statsByGroup(enriched, (e) => e.entryHourUtc),
    byWeekday: statsByGroup(enriched, (e) => e.entryWeekday),
    lossAnalysis: computeLossAnalysis(enriched),
    exitAnalysis: computeExitAnalysis(enriched),
  };
}

export interface StrategyRegimeMatrixCell {
  strategyId: string;
  strategyName: string;
  regime: string;
  trades: number;
  profitFactor: number | null;
  expectancy: number;
  totalPnl: number;
  insufficientSample: boolean;
}

/**
 * Spec section 9/10 — Strategy × Regime matrix across every strategy in one
 * benchmark run. Deliberately flat (one row per (strategy, regime) cell)
 * rather than a 2D structure, so the UI can pivot it however it wants
 * without this module making a layout decision. `INSUFFICIENT_SAMPLE`
 * cells are still returned (never dropped) — the caller decides how to
 * render them, but the data itself never pretends a thin cell is solid.
 */
export function computeStrategyRegimeMatrix(perStrategy: { strategyId: string; strategyName: string; trades: ReplayTradeRecord[]; decisions: ReplayDecisionRecord[] }[]): StrategyRegimeMatrixCell[] {
  const cells: StrategyRegimeMatrixCell[] = [];
  for (const s of perStrategy) {
    const enriched = attachRegimeToTrades(s.trades, s.decisions);
    const byRegime = groupBy(enriched, (e) => e.regime ?? "UNKNOWN");
    for (const [regime, regimeTrades] of byRegime) {
      const stats = computeBucketStats(regimeTrades);
      cells.push({
        strategyId: s.strategyId,
        strategyName: s.strategyName,
        regime: String(regime),
        trades: stats.trades,
        profitFactor: stats.profitFactor,
        expectancy: stats.expectancy,
        totalPnl: stats.totalPnl,
        insufficientSample: stats.insufficientSample,
      });
    }
  }
  return cells;
}
