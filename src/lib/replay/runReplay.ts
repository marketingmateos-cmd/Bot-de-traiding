import type { OHLCVBar } from "@/lib/providers/types";
import { getHistoricalBars } from "./historicalDataProvider";
import { evaluateHistoricalDataQuality } from "./replayDataQuality";
import { runReplayOnBars, type AssetMeta } from "./historicalReplayEngine";
import { ReplayDataUnavailableError } from "./errors";
import type { ReplayConfig, ReplayDataQualityReport, ReplaySegmentLabel, ReplaySegmentResult } from "./types";

export interface FetchedReplayData {
  barsByAsset: Map<string, OHLCVBar[]>;
  assetsMeta: Map<string, AssetMeta>;
  dataQuality: ReplayDataQualityReport;
}

/**
 * Fase 7 — fetches (once) and quality-gates the full-range bars every
 * segment/window of a run shares. Kept separate from
 * `historicalReplayEngine.ts`'s pure loop so IS/VALIDATION/OOS (Fase 7D)
 * and walk-forward (Fase 7E) can slice these SAME fetched bars in memory
 * instead of re-fetching per window.
 */
export async function fetchAndValidateReplayData(config: ReplayConfig, assetIdBySymbol: Map<string, string>): Promise<FetchedReplayData> {
  const barsByAsset = new Map<string, OHLCVBar[]>();
  const assetsMeta = new Map<string, AssetMeta>();
  const perAssetReports: ReplayDataQualityReport[] = [];

  for (const symbol of config.assetSymbols) {
    const result = getHistoricalBars(symbol, config.timeframe, config.startDate, config.endDate, config.dataSource);
    if (!result.available) {
      throw new ReplayDataUnavailableError(
        `no hay un proveedor de datos de mercado histórico REAL configurado para ${symbol} (solo existe el proveedor DEMO — ver providers/registry.ts). Usa dataSource: "SYNTHETIC" para probar la infraestructura.`
      );
    }
    barsByAsset.set(symbol, result.bars);
    assetsMeta.set(symbol, { symbol, assetId: assetIdBySymbol.get(symbol) ?? symbol });
    perAssetReports.push(evaluateHistoricalDataQuality(result.bars, config.timeframe, config.startDate, config.endDate));
  }

  const dataQuality = mergeDataQualityReports(perAssetReports);
  return { barsByAsset, assetsMeta, dataQuality };
}

function mergeDataQualityReports(reports: ReplayDataQualityReport[]): ReplayDataQualityReport {
  if (reports.length === 0) {
    return { coveragePct: 0, missingCandlesPct: 100, duplicateTimestamps: 0, invalidCandles: 0, futureLeakage: 0, chronologyViolations: 0, totalBarsExpected: 0, totalBarsPresent: 0, blocksReplay: true, warnings: ["No hay activos configurados."] };
  }
  return {
    coveragePct: reports.reduce((s, r) => s + r.coveragePct, 0) / reports.length,
    missingCandlesPct: reports.reduce((s, r) => s + r.missingCandlesPct, 0) / reports.length,
    duplicateTimestamps: reports.reduce((s, r) => s + r.duplicateTimestamps, 0),
    invalidCandles: reports.reduce((s, r) => s + r.invalidCandles, 0),
    futureLeakage: reports.reduce((s, r) => s + r.futureLeakage, 0),
    chronologyViolations: reports.reduce((s, r) => s + r.chronologyViolations, 0),
    totalBarsExpected: reports.reduce((s, r) => s + r.totalBarsExpected, 0),
    totalBarsPresent: reports.reduce((s, r) => s + r.totalBarsPresent, 0),
    blocksReplay: reports.some((r) => r.blocksReplay),
    warnings: reports.flatMap((r) => r.warnings),
  };
}

/** Runs one full (unsegmented) replay: fetch, quality-gate, execute. Throws ReplayDataUnavailableError or a data-quality error rather than running on bad data. */
export async function runFullReplay(config: ReplayConfig, assetIdBySymbol: Map<string, string>, label: ReplaySegmentLabel = "FULL"): Promise<{ result: ReplaySegmentResult; dataQuality: ReplayDataQualityReport }> {
  const { barsByAsset, assetsMeta, dataQuality } = await fetchAndValidateReplayData(config, assetIdBySymbol);
  if (dataQuality.blocksReplay) {
    throw new Error(`Calidad de datos insuficiente para ejecutar el replay: ${dataQuality.warnings.join(" ")}`);
  }
  const result = await runReplayOnBars(config, barsByAsset, assetsMeta, label);
  return { result, dataQuality };
}
