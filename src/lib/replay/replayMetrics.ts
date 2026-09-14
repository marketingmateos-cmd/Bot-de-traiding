import type { ReplayMetrics, ReplayTradeRecord } from "./types";

/**
 * Fase 7 — metrics for one replay segment. Deliberately structured as a
 * superset of `BacktestMetrics` (same field names/types) so the existing
 * `computeRobustnessScore`, `detectOverfitting`, and `compareToBenchmark`
 * engines (Fases 4/6, unmodified) accept a `ReplayMetrics` value directly —
 * no adapter needed, no duplicated math for the shared fields.
 */
export function computeReplayMetrics(
  equityCurve: { t: number; equity: number }[],
  trades: ReplayTradeRecord[],
  initialEquity: number,
  exposurePct: number,
  notionalExposure?: { max: number; avg: number }
): ReplayMetrics {
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialEquity;
  const totalReturnPct = initialEquity > 0 ? ((finalEquity - initialEquity) / initialEquity) * 100 : 0;

  const first = equityCurve[0]?.t;
  const last = equityCurve[equityCurve.length - 1]?.t;
  const years = first !== undefined && last !== undefined ? (last - first) / (1000 * 60 * 60 * 24 * 365) : null;
  const cagrPct = years && years > 0 && finalEquity > 0 ? (Math.pow(finalEquity / initialEquity, 1 / years) - 1) * 100 : null;

  const stepReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) stepReturns.push((equityCurve[i].equity - prev) / prev);
  }
  const mean = stepReturns.length ? stepReturns.reduce((a, b) => a + b, 0) / stepReturns.length : 0;
  const variance = stepReturns.length > 1 ? stepReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (stepReturns.length - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev === 0 ? null : (mean / stdDev) * Math.sqrt(252);
  const volatilityPct = stdDev * Math.sqrt(252) * 100;

  const downside = stepReturns.filter((r) => r < 0);
  const downsideStd = downside.length ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length) : 0;
  const sortino = downsideStd === 0 ? null : (mean / downsideStd) * Math.sqrt(252);

  let peak = initialEquity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const avgTradeReturnPct = trades.length ? (trades.reduce((s, t) => s + t.netPnl / Math.max(1e-9, t.entryPrice * t.quantity), 0) / trades.length) * 100 : 0;
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss;
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.netPnl, 0) / trades.length : 0;
  const avgWinPct = wins.length ? (wins.reduce((s, t) => s + t.netPnl / Math.max(1e-9, t.entryPrice * t.quantity), 0) / wins.length) * 100 : 0;
  const avgLossPct = losses.length ? (losses.reduce((s, t) => s + t.netPnl / Math.max(1e-9, t.entryPrice * t.quantity), 0) / losses.length) * 100 : 0;

  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of trades) {
    if (t.netPnl > 0) {
      curWin++;
      curLoss = 0;
    } else {
      curLoss++;
      curWin = 0;
    }
    longestWinStreak = Math.max(longestWinStreak, curWin);
    longestLossStreak = Math.max(longestLossStreak, curLoss);
  }

  return {
    totalReturnPct,
    cagrPct,
    sharpe,
    sortino,
    maxDrawdownPct,
    winRate,
    trades: trades.length,
    avgTradeReturnPct,
    profitFactor,
    finalEquity,
    expectancy,
    avgWinPct,
    avgLossPct,
    exposurePct,
    longestWinStreak,
    longestLossStreak,
    volatilityPct,
    maxExposurePct: notionalExposure?.max,
    avgExposurePct: notionalExposure?.avg,
  };
}
