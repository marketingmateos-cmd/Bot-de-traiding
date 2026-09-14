import type { ReplayTradeRecord, ReplayDecisionRecord } from "@/lib/replay/types";

/**
 * Fase 17 spec section 11/12 — the handful of descriptive figures the
 * existing `computeStrategyBenchmarkMetrics` (Fase 11) doesn't already
 * carry: realized R-multiples (average/median), long/short distribution,
 * total fees/slippage, and signal count. Pure post-processing over
 * `ReplayTradeRecord[]`/`ReplayDecisionRecord[]` that already exist on a
 * completed `ReplayResult` — never re-runs the replay, never used to pick
 * or filter a "winning" strategy (spec section 12: no automatic winner).
 */
export interface DescriptiveResearchStats {
  numSignals: number;
  numTrades: number;
  longCount: number;
  shortCount: number;
  avgR: number | null;
  medianR: number | null;
  totalFees: number;
  totalSlippage: number;
}

/** Realized R-multiple: net P&L direction-adjusted distance / the trade's OWN risk distance (|entry-stopLoss|), or null when the trade has no recorded stop (never assumed). Exported (Fase 20) so other descriptive modules — e.g. `phase20SessionAnalysis.ts`'s per-session bucketing — reuse the exact same R-multiple convention instead of re-deriving it. */
export function computeRMultiple(trade: ReplayTradeRecord): number | null {
  if (trade.stopLoss === null || trade.stopLoss === undefined) return null;
  const riskDistance = Math.abs(trade.entryPrice - trade.stopLoss);
  if (riskDistance <= 0) return null;
  const sign = trade.direction === "LONG" ? 1 : -1;
  const pnlDistance = sign * (trade.exitPrice - trade.entryPrice);
  return pnlDistance / riskDistance;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeDescriptiveResearchStats(trades: ReplayTradeRecord[], decisions: ReplayDecisionRecord[]): DescriptiveResearchStats {
  const rMultiples = trades.map(computeRMultiple).filter((v): v is number => v !== null);
  const sorted = [...rMultiples].sort((a, b) => a - b);

  return {
    numSignals: decisions.length, // every ReplayDecisionRecord is only ever created when a strategy actually produced a signal (see ReplayDecisionRecord's own doc comment)
    numTrades: trades.length,
    longCount: trades.filter((t) => t.direction === "LONG").length,
    shortCount: trades.filter((t) => t.direction === "SHORT").length,
    avgR: rMultiples.length === 0 ? null : rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length,
    medianR: median(sorted),
    totalFees: trades.reduce((s, t) => s + t.fees, 0),
    totalSlippage: trades.reduce((s, t) => s + t.slippageCost, 0),
  };
}
