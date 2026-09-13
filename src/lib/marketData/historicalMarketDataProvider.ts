import { prisma } from "@/lib/db";
import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";

/**
 * Fase 9 — historical market data is a fundamentally different shape of
 * request than the live `MarketDataProvider` (`src/lib/providers/types.ts`):
 * live trading asks "give me the latest N bars"; research asks "give me
 * everything between two dates". Deliberately a SEPARATE interface rather
 * than adding a date-range overload to `MarketDataProvider` — the live
 * provider and its `registry.ts` wiring are untouched by this feature.
 */
export interface HistoricalBarsWithProvenance {
  /** Strictly ordered ascending by timestamp, all within [startDate, endDate] inclusive. Never fabricates a bar that isn't in storage. */
  bars: OHLCVBar[];
  /**
   * Fase 9.1.11 — the REAL, distinct `MarketData.source` values actually
   * behind `bars` (e.g. `["binance_csv"]`, or `["binance", "binance_csv"]`
   * if a range happens to mix rows imported via both the live API and a
   * CSV backfill). Deduplicated, sorted for a stable order. Never a single
   * hardcoded guess — this is the one place true provenance is preserved;
   * see historicalDataProvider.ts's `HistoricalBarsResult.source`, which
   * stays a 3-way ROUTE indicator ("synthetic"/"binance"/"unavailable")
   * and is deliberately NOT the same thing as this field.
   */
  realSources: string[];
}

export interface HistoricalMarketDataProvider {
  readonly id: string;
  readonly isReal: boolean;
  getHistoricalBars(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date): Promise<HistoricalBarsWithProvenance>;
}

/**
 * Reads real historical candles previously written by
 * `src/lib/marketData/importer.ts` (live Binance API) or
 * `src/lib/marketData/offlineImporter.ts` (CSV, any explicit `source`
 * label) into the (previously dead) `MarketData` table. Filters
 * explicitly on `isDemo: false` — even if a demo/synthetic row were ever
 * accidentally persisted to this same table under a different `source`,
 * this provider would never surface it as real. Deliberately does NOT
 * filter by `source`: any real row for this asset/timeframe/range counts,
 * regardless of which real import path wrote it — `realSources` reports
 * exactly which one(s) so that information is never silently dropped.
 */
export class DbBackedHistoricalMarketDataProvider implements HistoricalMarketDataProvider {
  readonly id = "binance";
  readonly isReal = true;

  async getHistoricalBars(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date): Promise<HistoricalBarsWithProvenance> {
    const asset = await prisma.asset.findUnique({ where: { symbol: symbol.toUpperCase() } });
    if (!asset) return { bars: [], realSources: [] };

    const rows = await prisma.marketData.findMany({
      where: {
        assetId: asset.id,
        timeframe,
        isDemo: false,
        timestamp: { gte: startDate, lte: endDate },
      },
      orderBy: { timestamp: "asc" },
    });

    const bars = rows.map((row) => ({
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
    const realSources = Array.from(new Set(rows.map((row) => row.source))).sort();

    return { bars, realSources };
  }
}
