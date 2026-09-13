import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";
import { generateHistoricalWalk } from "@/lib/providers/market-data/demo-provider";
import { DbBackedHistoricalMarketDataProvider } from "@/lib/marketData/historicalMarketDataProvider";
import type { ReplayDataSource } from "./types";

export interface HistoricalBarsResult {
  bars: OHLCVBar[];
  available: boolean;
  source: "synthetic" | "binance" | "unavailable";
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
 *  - "HISTORICAL_REAL": reads real candles previously imported by
 *    `scripts/import-historical-market-data.mjs` into `MarketData`
 *    (`source: "binance"`, `isDemo: false`) via
 *    `DbBackedHistoricalMarketDataProvider` (Fase 9). If nothing has been
 *    imported yet for this (symbol, timeframe, range) — the common case
 *    before an import has run — this returns `available: false` exactly
 *    as before, rather than silently falling back to synthetic data and
 *    calling it real. Never a partial/best-effort substitute.
 */
export async function getHistoricalBars(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date, dataSource: ReplayDataSource): Promise<HistoricalBarsResult> {
  if (dataSource === "HISTORICAL_REAL") {
    const bars = await realProvider.getHistoricalBars(symbol, timeframe, startDate, endDate);
    if (bars.length === 0) return { bars: [], available: false, source: "unavailable" };
    return { bars, available: true, source: "binance" };
  }
  const bars = generateHistoricalWalk(symbol, timeframe, startDate, endDate);
  return { bars, available: true, source: "synthetic" };
}
