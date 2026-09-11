import type { OHLCVBar } from "@/lib/providers/types";
import type { StrategyDefinition, StrategyParams } from "./strategy/types";
import { runBacktest, type BacktestMetrics } from "./backtest";

export interface WalkForwardWindowResult {
  windowIndex: number;
  trainRange: [string, string];
  oosRange: [string, string];
  trainMetrics: BacktestMetrics;
  oosMetrics: BacktestMetrics;
  degraded: boolean; // true if OOS meaningfully underperforms train — a classic overfit tell
}

export interface WalkForwardResult {
  windows: WalkForwardWindowResult[];
  aggregateOosMetrics: {
    avgReturnPct: number;
    avgSharpe: number | null;
    winRateOfWindows: number; // fraction of windows with positive OOS return
  };
}

/**
 * Walk-Forward Testing (spec §24): TRAIN -> VALIDATION(OOS) -> ROLL FORWARD,
 * repeated across the full series. Each window's out-of-sample slice is data
 * the strategy has not been evaluated against before that window — the
 * split is purely chronological, so nothing from an OOS slice leaks
 * backward into an earlier train slice.
 */
export function runWalkForward(
  bars: OHLCVBar[],
  strategy: StrategyDefinition,
  params: StrategyParams,
  options?: { windowSize?: number; trainFraction?: number; step?: number }
): WalkForwardResult {
  const windowSize = options?.windowSize ?? 300;
  const trainFraction = options?.trainFraction ?? 0.7;
  const step = options?.step ?? windowSize;

  const windows: WalkForwardWindowResult[] = [];
  let windowIndex = 0;

  for (let start = 0; start + windowSize <= bars.length; start += step) {
    const windowBars = bars.slice(start, start + windowSize);
    const trainCount = Math.floor(windowSize * trainFraction);
    const trainBars = windowBars.slice(0, trainCount);
    const oosBars = windowBars.slice(trainCount);
    if (trainBars.length < 70 || oosBars.length < 30) continue;

    const trainResult = runBacktest(trainBars, strategy, params);
    const oosResult = runBacktest(oosBars, strategy, params);

    const degraded =
      trainResult.metrics.totalReturnPct > 0 &&
      (oosResult.metrics.totalReturnPct < trainResult.metrics.totalReturnPct * 0.3 || oosResult.metrics.totalReturnPct < 0);

    windows.push({
      windowIndex: windowIndex++,
      trainRange: [trainBars[0].timestamp.toISOString(), trainBars[trainBars.length - 1].timestamp.toISOString()],
      oosRange: [oosBars[0].timestamp.toISOString(), oosBars[oosBars.length - 1].timestamp.toISOString()],
      trainMetrics: trainResult.metrics,
      oosMetrics: oosResult.metrics,
      degraded,
    });
  }

  const oosReturns = windows.map((w) => w.oosMetrics.totalReturnPct);
  const oosSharpes = windows.map((w) => w.oosMetrics.sharpe).filter((s): s is number => s !== null);
  const avgReturnPct = oosReturns.length ? oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length : 0;
  const avgSharpe = oosSharpes.length ? oosSharpes.reduce((a, b) => a + b, 0) / oosSharpes.length : null;
  const winRateOfWindows = windows.length ? windows.filter((w) => w.oosMetrics.totalReturnPct > 0).length / windows.length : 0;

  return { windows, aggregateOosMetrics: { avgReturnPct, avgSharpe, winRateOfWindows } };
}
