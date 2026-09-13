import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";
import { generateHistoricalWalk } from "@/lib/providers/market-data/demo-provider";
import { DbBackedHistoricalMarketDataProvider } from "@/lib/marketData/historicalMarketDataProvider";
import type { ReplayDataSource } from "./types";

export interface HistoricalBarsResult {
  bars: OHLCVBar[];
  available: boolean;
  /**
   * A 3-way ROUTE indicator — which code path served these bars — NOT the
   * real `MarketData.source` value(s). Kept as this exact literal union
   * for backward compatibility with every existing caller/test that
   * branches on "synthetic"/"binance"/"unavailable"; a data set imported
   * via a CSV backfill still reports "binance" here, because from this
   * function's point of view it went through the same HISTORICAL_REAL/
   * DB-backed route. See `realSources` for the actual provenance.
   */
  source: "synthetic" | "binance" | "unavailable";
  /**
   * Fase 9.1.11 — the true `MarketData.source` value(s) behind `bars`
   * (e.g. `["binance_csv"]`), straight from `DbBackedHistoricalMarketDataProvider`.
   * Always `[]` for SYNTHETIC and for `unavailable` — there is no real
   * provenance to report in either case.
   */
  realSources: string[];
}

const realProvider = new DbBackedHistoricalMarketDataProvider();

/**
 * Fase 7/9 — the ONLY place Historical Replay gets OHLCV bars from. Three
 * honest outcomes, never a fourth that quietly blends them:
 *
 *  - "SYNTHETIC": a deterministic regime-switching random walk (the exact
 *    same generator the live DemoMarketDataProvider uses, see
 *    generateHistoricalWalk's doc comment), reproducible for the same
 *    (symbol, timeframe, range) no matter when the replay runs. This is
 *    fine for exercising the infrastructure, but it is NEVER evidence of a
 *    real historical edge (spec rule #5) — every caller must keep
 *    `source: "synthetic"` attached to whatever it produces from these bars.
 *  - "HISTORICAL_REAL": reads real candles previously imported by either
 *    `scripts/import-historical-market-data.mjs` (live Binance API) or
 *    `scripts/import-historical-market-data-from-file.mjs` (CSV, any
 *    explicit `source` label) into `MarketData` (`isDemo: false`) via
 *    `DbBackedHistoricalMarketDataProvider` (Fase 9/9.1). If nothing has
 *    been imported yet for this (symbol, timeframe, range) — the common
 *    case before an import has run — this returns `available: false`
 *    exactly as before, rather than silently falling back to synthetic
 *    data and calling it real. Never a partial/best-effort substitute.
 *    The real provenance (which import path(s) actually contributed) is
 *    never collapsed into the fixed "binance" route label — see
 *    `realSources`.
 */
export async function getHistoricalBars(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date, dataSource: ReplayDataSource): Promise<HistoricalBarsResult> {
  if (dataSource === "HISTORICAL_REAL") {
    const { bars, realSources } = await realProvider.getHistoricalBars(symbol, timeframe, startDate, endDate);
    if (bars.length === 0) return { bars: [], available: false, source: "unavailable", realSources: [] };
    return { bars, available: true, source: "binance", realSources };
  }
  const bars = generateHistoricalWalk(symbol, timeframe, startDate, endDate);
  return { bars, available: true, source: "synthetic", realSources: [] };
}
