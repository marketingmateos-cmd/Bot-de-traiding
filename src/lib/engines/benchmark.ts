import type { OHLCVBar } from "@/lib/providers/types";
import type { BacktestMetrics } from "./backtest";

export interface BenchmarkMetrics {
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  volatilityPct: number;
}

/** Buy & Hold benchmark (spec §28) — every strategy result must be shown against this, never presented in isolation. */
export function computeBuyAndHold(bars: OHLCVBar[]): BenchmarkMetrics {
  if (bars.length < 2) {
    return { totalReturnPct: 0, maxDrawdownPct: 0, sharpe: null, volatilityPct: 0 };
  }
  const closes = bars.map((b) => b.close);
  const totalReturnPct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;

  let peak = closes[0];
  let maxDrawdownPct = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - c) / peak) * 100);
  }

  const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev === 0 ? null : (mean / stdDev) * Math.sqrt(252);
  const volatilityPct = stdDev * Math.sqrt(252) * 100;

  return { totalReturnPct, maxDrawdownPct, sharpe, volatilityPct };
}

export interface BenchmarkComparison {
  strategyBeatsReturn: boolean;
  strategyBeatsRisk: boolean; // lower max drawdown
  strategyBeatsSharpe: boolean;
  returnGapPct: number; // strategy - benchmark
  summary: string;
}

export function compareToBenchmark(strategy: BacktestMetrics, benchmark: BenchmarkMetrics): BenchmarkComparison {
  const strategyBeatsReturn = strategy.totalReturnPct > benchmark.totalReturnPct;
  const strategyBeatsRisk = strategy.maxDrawdownPct < benchmark.maxDrawdownPct;
  const strategyBeatsSharpe = (strategy.sharpe ?? -Infinity) > (benchmark.sharpe ?? -Infinity);
  const returnGapPct = strategy.totalReturnPct - benchmark.totalReturnPct;

  const summary = strategyBeatsReturn
    ? `Strategy outperformed Buy & Hold by ${returnGapPct.toFixed(1)} percentage points.`
    : `Strategy UNDERPERFORMED Buy & Hold by ${Math.abs(returnGapPct).toFixed(1)} percentage points — a passive hold would have done better.`;

  return { strategyBeatsReturn, strategyBeatsRisk, strategyBeatsSharpe, returnGapPct, summary };
}
