import { computeTradeStats, type StrategyPerformanceStats } from "./strategyStats";

export interface JournalTradeLike {
  id: string;
  closedAt: Date;
  openedAt: Date;
  netPnl: number;
  entryPrice: number;
  quantity: number;
  direction: string;
  exitReason: string;
  assetSymbol: string;
  assetClass: string;
  strategyName: string;
  strategyVersionId: string | null;
}

export interface DailyStat {
  date: string; // YYYY-MM-DD (UTC)
  startingBalance: number;
  endingBalance: number;
  pnl: number;
  pnlPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Walks trades in closing order building one row per calendar day the bot
 * actually traded — starting balance of a day is the previous day's ending
 * balance, so this is a real day-by-day equity walk, not an approximation.
 */
export function computeDailyStats(trades: JournalTradeLike[], startingBalance: number): DailyStat[] {
  const byDate = new Map<string, JournalTradeLike[]>();
  for (const t of [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime())) {
    const key = dayKey(t.closedAt);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(t);
  }

  let running = startingBalance;
  const result: DailyStat[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const dayTrades = byDate.get(date)!;
    const start = running;
    const pnl = dayTrades.reduce((s, t) => s + t.netPnl, 0);
    running += pnl;
    const wins = dayTrades.filter((t) => t.netPnl > 0);
    const losses = dayTrades.filter((t) => t.netPnl <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    result.push({
      date,
      startingBalance: start,
      endingBalance: running,
      pnl,
      pnlPct: start > 0 ? (pnl / start) * 100 : 0,
      trades: dayTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: dayTrades.length ? (wins.length / dayTrades.length) * 100 : 0,
      avgWin: wins.length ? grossProfit / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss,
    });
  }
  return result;
}

export interface StreakInfo {
  currentType: "WIN" | "LOSS" | null;
  currentCount: number;
  bestWinStreak: number;
  worstLossStreak: number;
}

/** Trades must already be sorted ascending by closedAt. */
export function computeStreaks(tradesAsc: { netPnl: number }[]): StreakInfo {
  let bestWin = 0;
  let worstLoss = 0;
  let runWin = 0;
  let runLoss = 0;
  let currentType: "WIN" | "LOSS" | null = null;
  let currentCount = 0;

  for (const t of tradesAsc) {
    const isWin = t.netPnl > 0;
    if (isWin) {
      runWin++;
      runLoss = 0;
      bestWin = Math.max(bestWin, runWin);
    } else {
      runLoss++;
      runWin = 0;
      worstLoss = Math.max(worstLoss, runLoss);
    }
    currentType = isWin ? "WIN" : "LOSS";
    currentCount = isWin ? runWin : runLoss;
  }

  return { currentType, currentCount, bestWinStreak: bestWin, worstLossStreak: worstLoss };
}

const DOW_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export interface DayOfWeekStat {
  label: string;
  trades: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

/** Never assumes a pattern exists (spec §7) — a weekday with zero trades just shows zero, not a guess. */
export function computeDayOfWeekStats(trades: { closedAt: Date; netPnl: number }[]): DayOfWeekStat[] {
  const buckets: { netPnl: number }[][] = Array.from({ length: 7 }, () => []);
  for (const t of trades) buckets[t.closedAt.getUTCDay()].push(t);

  return buckets.map((dayTrades, i) => {
    const wins = dayTrades.filter((t) => t.netPnl > 0).length;
    const totalPnl = dayTrades.reduce((s, t) => s + t.netPnl, 0);
    return {
      label: DOW_LABELS[i],
      trades: dayTrades.length,
      winRate: dayTrades.length ? (wins / dayTrades.length) * 100 : 0,
      avgPnl: dayTrades.length ? totalPnl / dayTrades.length : 0,
      totalPnl,
    };
  });
}

export function bestWorstDays(daily: DailyStat[], count = 5): { best: DailyStat[]; worst: DailyStat[] } {
  const sorted = [...daily].sort((a, b) => b.pnl - a.pnl);
  return { best: sorted.slice(0, count), worst: sorted.slice(-count).reverse() };
}

export function bestWorstTrade<T extends { netPnl: number }>(trades: T[]): { best: T | null; worst: T | null } {
  if (trades.length === 0) return { best: null, worst: null };
  let best = trades[0];
  let worst = trades[0];
  for (const t of trades) {
    if (t.netPnl > best.netPnl) best = t;
    if (t.netPnl < worst.netPnl) worst = t;
  }
  return { best, worst };
}

export interface GroupPerformance {
  key: string;
  label: string;
  stats: StrategyPerformanceStats;
}

/** Generic "group trades by X, compute the same stats formula per group" — reused for strategy/asset/direction/risk-bucket breakdowns. */
export function groupPerformance<T extends { netPnl: number; entryPrice: number; quantity: number }>(
  trades: T[],
  keyFn: (t: T) => string,
  labelFn: (key: string) => string
): GroupPerformance[] {
  const groups = new Map<string, T[]>();
  for (const t of trades) {
    const key = keyFn(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return [...groups.entries()]
    .map(([key, groupTrades]) => ({ key, label: labelFn(key), stats: computeTradeStats(groupTrades) }))
    .sort((a, b) => b.stats.totalNetPnl - a.stats.totalNetPnl);
}

export interface DrawdownInfo {
  current: number;
  max: number;
  currentDurationDays: number;
  maxDurationDays: number;
}

/** Same peak-to-trough math as riskEngine.computeDrawdown, but also tracks how long each drawdown has lasted in days. */
export function computeDrawdownWithDuration(daily: DailyStat[]): DrawdownInfo {
  if (daily.length === 0) return { current: 0, max: 0, currentDurationDays: 0, maxDurationDays: 0 };

  let peak = daily[0].endingBalance;
  let peakIndex = 0;
  let maxDrawdown = 0;
  let maxDurationDays = 0;
  let currentDrawdown = 0;
  let currentDurationDays = 0;

  daily.forEach((d, i) => {
    if (d.endingBalance >= peak) {
      peak = d.endingBalance;
      peakIndex = i;
    }
    const dd = peak > 0 ? ((peak - d.endingBalance) / peak) * 100 : 0;
    const durationDays = i - peakIndex;
    maxDrawdown = Math.max(maxDrawdown, dd);
    maxDurationDays = Math.max(maxDurationDays, durationDays);
    currentDrawdown = dd;
    currentDurationDays = durationDays;
  });

  return { current: currentDrawdown, max: maxDrawdown, currentDurationDays, maxDurationDays };
}
