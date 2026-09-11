import { prisma } from "@/lib/db";

export interface StrategyPerformanceStats {
  trades: number;
  winRate: number;
  avgReturnPct: number;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number;
  totalNetPnl: number;
  profitFactor: number | null;
}

/**
 * Pulls realized-trade performance for a strategy version straight from the
 * Trade Journal (paper trades only). This is what the AI Critic, Strategy
 * League, and Luck-vs-Edge screens consult instead of trusting a strategy's
 * self-reported backtest.
 */
export async function getStrategyPerformanceStats(strategyVersionId: string): Promise<StrategyPerformanceStats> {
  const trades = await prisma.trade.findMany({
    where: { strategyVersionId },
    orderBy: { closedAt: "asc" },
  });

  if (trades.length === 0) {
    return { trades: 0, winRate: 0, avgReturnPct: 0, sharpe: null, sortino: null, maxDrawdownPct: 0, totalNetPnl: 0, profitFactor: null };
  }

  const returns = trades.map((t) => t.netPnl / Math.max(1e-9, t.entryPrice * t.quantity));
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const winRate = wins.length / trades.length;
  const avgReturnPct = (returns.reduce((a, b) => a + b, 0) / returns.length) * 100;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev === 0 ? null : (mean / stdDev) * Math.sqrt(returns.length);

  const downside = returns.filter((r) => r < 0);
  const downsideVariance = downside.length > 0 ? downside.reduce((sum, r) => sum + r ** 2, 0) / downside.length : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sortino = downsideDev === 0 ? null : (mean / downsideDev) * Math.sqrt(returns.length);

  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }

  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss;

  const totalNetPnl = trades.reduce((s, t) => s + t.netPnl, 0);

  return { trades: trades.length, winRate, avgReturnPct, sharpe, sortino, maxDrawdownPct, totalNetPnl, profitFactor };
}
