import type { OHLCVBar } from "@/lib/providers/types";
import type { WalkForwardResult, WalkForwardWindowResult } from "@/lib/engines/walkForward";
import { fetchAndValidateReplayData } from "./runReplay";
import { runReplayOnBars } from "./historicalReplayEngine";
import type { ReplayConfig, ReplayDataQualityReport } from "./types";

export interface ReplayWalkForwardOptions {
  windowSizeDays: number;
  trainFraction: number; // 0-1, e.g. 0.7 = 70% train / 30% test within each window
  stepDays: number; // how far each window slides forward
}

export interface ReplayWalkForwardOutput {
  walkForward: WalkForwardResult;
  dataQuality: ReplayDataQualityReport;
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Fase 7E — Walk-Forward over the FULL pipeline replay (not the simpler
 * strategy-only `runBacktest`): TRAIN -> TEST, slide the window forward by
 * `stepDays`, repeat across the whole requested range. Each window's train
 * and test segments are two genuinely independent replay runs (same
 * isolation guarantees as `runIsValidationOosReplay`) — a window's test
 * (OOS) period never shares a portfolio with its own train period, and
 * never leaks into any other window.
 *
 * Returns the SAME `WalkForwardResult` shape the existing (Fase 4)
 * `computeRobustnessScore`/`detectOverfitting` engines already consume —
 * `ReplayMetrics` is a structural superset of `BacktestMetrics`, so no
 * adapter or duplicated math is needed to feed a full-pipeline replay's
 * walk-forward into those unmodified engines.
 */
export async function runReplayWalkForward(config: ReplayConfig, fullRange: { start: Date; end: Date }, options: ReplayWalkForwardOptions, assetIdBySymbol: Map<string, string>): Promise<ReplayWalkForwardOutput> {
  const fetchConfig: ReplayConfig = { ...config, startDate: fullRange.start, endDate: fullRange.end };
  const { barsByAsset, assetsMeta, dataQuality } = await fetchAndValidateReplayData(fetchConfig, assetIdBySymbol);
  if (dataQuality.blocksReplay) {
    throw new Error(`Calidad de datos insuficiente para ejecutar walk-forward: ${dataQuality.warnings.join(" ")}`);
  }

  const windowMs = options.windowSizeDays * DAY_MS;
  const stepMs = options.stepDays * DAY_MS;
  const windows: WalkForwardWindowResult[] = [];

  let windowIndex = 0;
  for (let windowStart = fullRange.start.getTime(); windowStart + windowMs <= fullRange.end.getTime(); windowStart += stepMs) {
    const windowEnd = windowStart + windowMs;
    const trainEnd = windowStart + Math.floor(windowMs * options.trainFraction);
    if (trainEnd <= windowStart || windowEnd <= trainEnd) continue;

    const barsUpToWindowEnd = new Map<string, OHLCVBar[]>();
    for (const [symbol, bars] of barsByAsset) {
      barsUpToWindowEnd.set(symbol, bars.filter((b) => b.timestamp.getTime() <= windowEnd));
    }

    const [trainResult, testResult] = await Promise.all([
      runReplayOnBars(config, barsUpToWindowEnd, assetsMeta, `wf-${windowIndex}-train`, { tradingStartMs: windowStart, tradingEndMs: trainEnd }),
      runReplayOnBars(config, barsUpToWindowEnd, assetsMeta, `wf-${windowIndex}-test`, { tradingStartMs: trainEnd, tradingEndMs: windowEnd }),
    ]);

    const degraded = trainResult.metrics.totalReturnPct > 0 && (testResult.metrics.totalReturnPct < trainResult.metrics.totalReturnPct * 0.3 || testResult.metrics.totalReturnPct < 0);

    windows.push({
      windowIndex,
      trainRange: [new Date(windowStart).toISOString(), new Date(trainEnd).toISOString()],
      oosRange: [new Date(trainEnd).toISOString(), new Date(windowEnd).toISOString()],
      trainMetrics: trainResult.metrics,
      oosMetrics: testResult.metrics,
      degraded,
    });
    windowIndex++;
  }

  const oosReturns = windows.map((w) => w.oosMetrics.totalReturnPct);
  const oosSharpes = windows.map((w) => w.oosMetrics.sharpe).filter((s): s is number => s !== null);
  const avgReturnPct = oosReturns.length ? oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length : 0;
  const avgSharpe = oosSharpes.length ? oosSharpes.reduce((a, b) => a + b, 0) / oosSharpes.length : null;
  const winRateOfWindows = windows.length ? windows.filter((w) => w.oosMetrics.totalReturnPct > 0).length / windows.length : 0;

  return {
    walkForward: { windows, aggregateOosMetrics: { avgReturnPct, avgSharpe, winRateOfWindows } },
    dataQuality,
  };
}
