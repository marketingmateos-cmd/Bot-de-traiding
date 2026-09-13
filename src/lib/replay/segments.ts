import type { OHLCVBar } from "@/lib/providers/types";
import { fetchAndValidateReplayData } from "./runReplay";
import { runReplayOnBars } from "./historicalReplayEngine";
import type { ReplayConfig, ReplayDataQualityReport, ReplaySegmentResult } from "./types";

export interface SegmentDateRange {
  start: Date;
  end: Date;
}

export interface IsValidationOosRanges {
  is: SegmentDateRange;
  validation: SegmentDateRange;
  oos: SegmentDateRange;
}

export interface SegmentedReplayResult {
  is: ReplaySegmentResult;
  validation: ReplaySegmentResult;
  oos: ReplaySegmentResult;
  dataQuality: ReplayDataQualityReport;
}

/**
 * Fase 7D — IN-SAMPLE / VALIDATION / OUT-OF-SAMPLE, run as three
 * INDEPENDENT replays that never share a portfolio, equity curve, or trade
 * list — "NO mezclar las métricas" (spec) enforced structurally: this
 * function always returns three separate `ReplaySegmentResult` values,
 * there is no code path that could merge them into one.
 *
 * Each segment's replay is handed bars starting from the run's overall
 * start (not the segment's own start) so its indicators are already warm
 * by the time its OWN trading window begins — using genuinely earlier REAL
 * (or synthetic, per dataSource) bars for that warmup, never fabricated —
 * but `tradingStartMs`/`tradingEndMs` mean no trade can open and no
 * decision is recorded before the segment's own start, so nothing from an
 * earlier segment (in particular OOS's own preceding IS/VALIDATION period)
 * ever counts toward a later segment's trades or metrics. This also means
 * OOS results can never feed back into IS — there is no optimizer anywhere
 * in this codebase that could act on them even if they did (spec: "Nunca
 * utilizar OOS para ajustar estrategias").
 */
export async function runIsValidationOosReplay(config: ReplayConfig, ranges: IsValidationOosRanges, assetIdBySymbol: Map<string, string>): Promise<SegmentedReplayResult> {
  const overallStart = ranges.is.start;
  const overallEnd = ranges.oos.end;
  const fetchConfig: ReplayConfig = { ...config, startDate: overallStart, endDate: overallEnd };
  const { barsByAsset, assetsMeta, dataQuality } = await fetchAndValidateReplayData(fetchConfig, assetIdBySymbol);

  if (dataQuality.blocksReplay) {
    throw new Error(`Calidad de datos insuficiente para ejecutar IS/VALIDATION/OOS: ${dataQuality.warnings.join(" ")}`);
  }

  const runSegment = (label: "IS" | "VALIDATION" | "OOS", range: SegmentDateRange) => {
    const barsUpToSegmentEnd = new Map<string, OHLCVBar[]>();
    for (const [symbol, bars] of barsByAsset) {
      barsUpToSegmentEnd.set(symbol, bars.filter((b) => b.timestamp.getTime() <= range.end.getTime()));
    }
    return runReplayOnBars(config, barsUpToSegmentEnd, assetsMeta, label, {
      tradingStartMs: range.start.getTime(),
      tradingEndMs: range.end.getTime(),
    });
  };

  const [is, validation, oos] = await Promise.all([runSegment("IS", ranges.is), runSegment("VALIDATION", ranges.validation), runSegment("OOS", ranges.oos)]);

  return { is, validation, oos, dataQuality };
}
