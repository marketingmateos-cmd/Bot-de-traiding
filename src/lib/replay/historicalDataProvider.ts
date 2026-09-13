import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";
import { generateHistoricalWalk } from "@/lib/providers/market-data/demo-provider";
import type { ReplayDataSource } from "./types";

export interface HistoricalBarsResult {
  bars: OHLCVBar[];
  available: boolean;
  source: "synthetic" | "unavailable";
}

/**
 * Fase 7 — the ONLY place Historical Replay gets OHLCV bars from. Two
 * honest outcomes, never a third that quietly blends them:
 *
 *  - "SYNTHETIC": a deterministic regime-switching random walk (the exact
 *    same generator the live DemoMarketDataProvider uses, see
 *    generateHistoricalWalk's doc comment), reproducible for the same
 *    (symbol, timeframe, range) no matter when the replay runs. This is
 *    fine for exercising the infrastructure, but it is NEVER evidence of a
 *    real historical edge (spec rule #5) — every caller must keep
 *    `source: "synthetic"` attached to whatever it produces from these bars.
 *  - "HISTORICAL_REAL": no real historical market data provider is wired
 *    up in this environment (see providers/registry.ts — only "demo" is
 *    implemented today). Rather than silently falling back to synthetic
 *    data and calling it real, this returns `available: false` — the
 *    caller must surface "HISTORICAL DATA UNAVAILABLE" (spec rule #3),
 *    never invent a real-looking series.
 */
export function getHistoricalBars(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date, dataSource: ReplayDataSource): HistoricalBarsResult {
  if (dataSource === "HISTORICAL_REAL") {
    return { bars: [], available: false, source: "unavailable" };
  }
  const bars = generateHistoricalWalk(symbol, timeframe, startDate, endDate);
  return { bars, available: true, source: "synthetic" };
}
