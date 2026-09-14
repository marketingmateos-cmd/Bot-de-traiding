import type { ReplayTradeRecord } from "@/lib/replay/types";
import { getSessionsForTimestamp, type SessionDefinition } from "@/lib/engines/edgeSignals/session";
import { computeRMultiple } from "./researchStrategyStats";
import { MIN_SAMPLE_SIZE } from "./phase20PreRegistration";

/**
 * Fase 20 — Family D: Session / Time-of-Day Structural Effect. Spec
 * Condición 6: F20-D is a DESCRIPTIVE analysis applied RETROSPECTIVELY to
 * trades that ALREADY EXIST (produced by Fase 17/18's real, unmodified
 * 9-strategy replay/validation runs) — this module never runs a replay
 * itself, never generates a new signal, and is never formalized as a
 * `StrategyDefinition` this phase (`F20D_FORMALIZE_AS_STRATEGY === false`,
 * frozen in `phase20PreRegistration.ts`). It only buckets already-realized
 * trades by which of the 3 frozen sessions their ENTRY fell into and
 * reports plain descriptive stats per bucket — no p-value, no automatic
 * pass/fail, no hidden statistical test. A trade whose entry hour falls in
 * the LONDON/NY overlap window is counted in BOTH buckets (this is the
 * same standard market convention `F20D_SESSIONS` already documents, not a
 * bug) — so per-session counts may sum to more than the total trade count,
 * and that is reported explicitly, never silently.
 */

export interface SessionDescriptiveStats {
  session: string;
  tradeCount: number;
  insufficientSample: boolean;
  winRate: number | null;
  totalNetPnl: number;
  avgNetPnl: number | null;
  avgR: number | null;
  medianR: number | null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Groups trades by session name (a trade may appear under more than one session when sessions overlap, e.g. LONDON/NY) — bucketed by the trade's ENTRY timestamp, never its exit (the entry is the causal decision point). */
export function bucketTradesBySession(trades: ReplayTradeRecord[], sessions: SessionDefinition[]): Record<string, ReplayTradeRecord[]> {
  const buckets: Record<string, ReplayTradeRecord[]> = {};
  for (const s of sessions) buckets[s.name] = [];
  for (const trade of trades) {
    const entryDate = new Date(trade.entryTime);
    const sessionNames = getSessionsForTimestamp(entryDate, sessions);
    for (const name of sessionNames) {
      buckets[name].push(trade);
    }
  }
  return buckets;
}

function describeTrades(trades: ReplayTradeRecord[]): Omit<SessionDescriptiveStats, "session"> {
  const rMultiples = trades.map(computeRMultiple).filter((v): v is number => v !== null);
  const sortedR = [...rMultiples].sort((a, b) => a - b);
  const wins = trades.filter((t) => t.netPnl > 0).length;

  return {
    tradeCount: trades.length,
    insufficientSample: trades.length < MIN_SAMPLE_SIZE,
    winRate: trades.length === 0 ? null : wins / trades.length,
    totalNetPnl: trades.reduce((s, t) => s + t.netPnl, 0),
    avgNetPnl: trades.length === 0 ? null : trades.reduce((s, t) => s + t.netPnl, 0) / trades.length,
    avgR: rMultiples.length === 0 ? null : rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length,
    medianR: median(sortedR),
  };
}

/** The full per-session descriptive breakdown for one set of already-realized trades (typically one strategy's trades within one IS/VALIDATION/OOS segment). */
export function computeSessionDescriptiveStats(trades: ReplayTradeRecord[], sessions: SessionDefinition[]): SessionDescriptiveStats[] {
  const buckets = bucketTradesBySession(trades, sessions);
  return sessions.map((s) => ({ session: s.name, ...describeTrades(buckets[s.name]) }));
}
