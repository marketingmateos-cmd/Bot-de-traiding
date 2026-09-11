import { mulberry32 } from "@/lib/providers/market-data/seeded-random";
import type { BacktestTradeRecord } from "./backtest";

export interface MonteCarloResult {
  iterations: number;
  finalReturnPct: { p5: number; p25: number; median: number; p75: number; p95: number; mean: number };
  maxDrawdownPct: { p5: number; p50: number; p95: number };
  probabilityOfRuin: number; // probability equity ever drops below `ruinThresholdPct` of starting equity
  probabilityOfLoss: number; // probability final equity < starting equity
  ruinThresholdPct: number;
}

/**
 * Monte Carlo Lab (spec §25): resamples the ORDER of a strategy's own
 * historical trade returns (bootstrap with replacement) to see how much of
 * the equity curve's shape was one lucky sequencing of real trades, rather
 * than treating Monte Carlo as a way to project future profits — it isn't
 * used anywhere in this codebase to "guarantee" returns, only to characterize
 * risk of ruin and result stability.
 */
export function runMonteCarlo(
  trades: BacktestTradeRecord[],
  initialEquity: number,
  options?: { iterations?: number; ruinThresholdPct?: number; seed?: number }
): MonteCarloResult {
  const iterations = options?.iterations ?? 1000;
  const ruinThresholdPct = options?.ruinThresholdPct ?? 50;
  const rand = mulberry32(options?.seed ?? 42);

  if (trades.length === 0) {
    return {
      iterations: 0,
      finalReturnPct: { p5: 0, p25: 0, median: 0, p75: 0, p95: 0, mean: 0 },
      maxDrawdownPct: { p5: 0, p50: 0, p95: 0 },
      probabilityOfRuin: 0,
      probabilityOfLoss: 0,
      ruinThresholdPct,
    };
  }

  const tradeReturnsAbs = trades.map((t) => t.netPnl); // absolute $ pnl per trade, resampled directly

  const finalReturns: number[] = [];
  const maxDrawdowns: number[] = [];
  let ruinCount = 0;
  let lossCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    let equity = initialEquity;
    let peak = initialEquity;
    let maxDd = 0;
    let ruined = false;

    for (let t = 0; t < tradeReturnsAbs.length; t++) {
      const idx = Math.floor(rand() * tradeReturnsAbs.length);
      equity += tradeReturnsAbs[idx];
      peak = Math.max(peak, equity);
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      maxDd = Math.max(maxDd, dd);
      if (equity <= initialEquity * (1 - ruinThresholdPct / 100)) ruined = true;
    }

    const returnPct = ((equity - initialEquity) / initialEquity) * 100;
    finalReturns.push(returnPct);
    maxDrawdowns.push(maxDd);
    if (ruined) ruinCount++;
    if (returnPct < 0) lossCount++;
  }

  finalReturns.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  return {
    iterations,
    finalReturnPct: {
      p5: percentile(finalReturns, 5),
      p25: percentile(finalReturns, 25),
      median: percentile(finalReturns, 50),
      p75: percentile(finalReturns, 75),
      p95: percentile(finalReturns, 95),
      mean: finalReturns.reduce((a, b) => a + b, 0) / finalReturns.length,
    },
    maxDrawdownPct: { p5: percentile(maxDrawdowns, 5), p50: percentile(maxDrawdowns, 50), p95: percentile(maxDrawdowns, 95) },
    probabilityOfRuin: ruinCount / iterations,
    probabilityOfLoss: lossCount / iterations,
    ruinThresholdPct,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}
