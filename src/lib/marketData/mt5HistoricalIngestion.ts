import type { TradingExecutionAdapter, Mt5HistoricalTimeframe } from "@/lib/execution/types";
import { resolveMt5Symbol } from "@/lib/execution/mt5SymbolMapper";
import { importHistoricalMarketDataForBars, type OfflineImportStats } from "./offlineImporter";
import { registerResearchDataset, type ResearchDatasetView } from "@/lib/research/researchDataset";

/**
 * MT5 Data Connector phase — the ONLY orchestration point that ties
 * `TradingExecutionAdapter` (MT5 connection/data) to the existing
 * research pipeline (offlineImporter.ts, researchDataset.ts). This file
 * NEVER calls `adapter.placeOrder` — enforced by a structural test
 * (grep this file's own source for "placeOrder"/"orderSend") — it only
 * ever reads: verifyAccountIsDemo, getHistoricalBars, and (via
 * mt5SymbolMapper.ts) getSymbols.
 *
 * Pipeline:
 *   MT5 DEMO -> adapter.getHistoricalBars() -> importHistoricalMarketDataForBars()
 *   (validation + idempotent upsert, same as every other real import)
 *   -> registerResearchDataset() (hash + provenance, unmodified)
 *
 * Requires the caller to have already `connect()`-ed the adapter (credential
 * lifecycle lives in the caller — see scripts/mt5-ingest-historical.mjs) —
 * this function re-verifies demo status itself regardless, defense in
 * depth, never trusting a caller's own prior check.
 */

export const MT5_DEFAULT_SOURCE = "mt5_demo";

export class Mt5NotDemoError extends Error {}
export class Mt5SymbolUnavailableError extends Error {}

export interface Mt5IngestionRequest {
  /** The EdgeLab canonical symbol (e.g. "EURUSD", "XAUUSD", "US500") — resolved to a broker-specific MT5 symbol via mt5SymbolMapper.ts, never assumed equal. */
  edgeLabSymbol: string;
  timeframe: Mt5HistoricalTimeframe;
  startDate: Date;
  endDate: Date;
  /** Defaults to "mt5_demo" — always distinct from any Binance source label, so MT5 and Binance rows are never mixed under the same provenance. */
  source?: string;
}

export interface Mt5IngestionResult {
  edgeLabSymbol: string;
  mt5Symbol: string;
  timeframe: Mt5HistoricalTimeframe;
  importStats: OfflineImportStats;
  /** Null when nothing valid was actually persisted (e.g. the whole range was invalid/empty) — a dataset is never registered over zero real rows. */
  dataset: ResearchDatasetView | null;
}

export async function ingestMt5HistoricalData(adapter: TradingExecutionAdapter, request: Mt5IngestionRequest): Promise<Mt5IngestionResult> {
  const verifiedDemo = await adapter.verifyAccountIsDemo();
  if (!verifiedDemo) {
    throw new Mt5NotDemoError("Account is not a MetaTrader 5 DEMO account — historical ingestion refused.");
  }

  const symbolResolution = await resolveMt5Symbol(request.edgeLabSymbol, adapter);
  if (!symbolResolution.ok) {
    throw new Mt5SymbolUnavailableError(symbolResolution.reason);
  }
  const mt5Symbol = symbolResolution.mt5Symbol;

  const bars = await adapter.getHistoricalBars(mt5Symbol, request.timeframe, request.startDate, request.endDate);
  const source = request.source ?? MT5_DEFAULT_SOURCE;

  const importStats = await importHistoricalMarketDataForBars({
    internalSymbol: request.edgeLabSymbol,
    timeframe: request.timeframe,
    source,
    bars,
    startDate: request.startDate,
    endDate: request.endDate,
  });

  let dataset: ResearchDatasetView | null = null;
  if (importStats.firstTimestamp && importStats.lastTimestamp) {
    dataset = await registerResearchDataset({
      symbol: request.edgeLabSymbol,
      timeframe: request.timeframe,
      startDate: importStats.firstTimestamp,
      endDate: importStats.lastTimestamp,
      source,
    });
  }

  return { edgeLabSymbol: request.edgeLabSymbol, mt5Symbol, timeframe: request.timeframe, importStats, dataset };
}
