import type { StrategyPerformanceStats } from "./strategyStats";

export interface LeagueEntryInput {
  strategyVersionId: string;
  strategyName: string;
  version: string;
  stats: StrategyPerformanceStats;
  robustnessScore: number | null;
  oosSharpe: number | null;
  benchmarkReturnPct: number | null;
}

export interface LeagueEntry extends LeagueEntryInput {
  compositeScore: number;
  rank: number;
}

/**
 * Strategy League (spec §29). Deliberately NOT sorted by raw return — the
 * composite score rewards risk-adjusted, robust, well-evidenced performance
 * and penalizes thin samples, so a strategy that got lucky for two weeks
 * cannot outrank one with a real, tested edge.
 */
export function rankStrategies(entries: LeagueEntryInput[]): LeagueEntry[] {
  const scored = entries.map((e) => ({ ...e, compositeScore: computeCompositeScore(e) }));
  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  return scored.map((e, i) => ({ ...e, rank: i + 1 }));
}

function computeCompositeScore(entry: LeagueEntryInput): number {
  const { stats, robustnessScore, oosSharpe, benchmarkReturnPct } = entry;

  const sampleSizeFactor = Math.min(1, stats.trades / 100); // caps out at 100 trades
  const sharpeComponent = clamp01(((stats.sharpe ?? 0) + 1) / 3) * 25;
  const sortinoComponent = clamp01(((stats.sortino ?? 0) + 1) / 3) * 15;
  const drawdownComponent = clamp01(1 - stats.maxDrawdownPct / 40) * 15;
  const robustnessComponent = clamp01((robustnessScore ?? 0) / 100) * 20;
  const oosComponent = clamp01(((oosSharpe ?? -1) + 1) / 3) * 15;
  const benchmarkComponent =
    benchmarkReturnPct !== null ? clamp01((stats.totalNetPnl > 0 ? 1 : 0) * (stats.avgReturnPct > benchmarkReturnPct ? 1 : 0.3)) * 10 : 5;

  const rawScore = sharpeComponent + sortinoComponent + drawdownComponent + robustnessComponent + oosComponent + benchmarkComponent;
  // Scale the whole thing down by sample size so a strategy with 3 trades
  // cannot reach a high composite score no matter how good those 3 looked.
  return Math.round(rawScore * (0.4 + 0.6 * sampleSizeFactor));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
