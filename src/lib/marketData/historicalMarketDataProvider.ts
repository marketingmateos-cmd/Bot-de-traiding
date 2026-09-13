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
export interface HistoricalMarketDataProvider {
  readonly id: string;
  readonly isReal: boolean;
  /** Returns bars strictly ordered ascending by timestamp, all within [startDate, endDate] inclusive. Never fabricates a bar that isn't in storage. */
  getHistoricalBars(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date): Promise<OHLCVBar[]>;
}

/**
 * Reads real historical candles previously written by
 * `src/lib/marketData/importer.ts` into the (previously dead) `MarketData`
 * table. Filters explicitly on `isDemo: false` — even if a demo/synthetic
 * row were ever accidentally persisted to this same table under a
 * different `source`, this provider would never surface it as real.
 */
export class DbBackedHistoricalMarketDataProvider implements HistoricalMarketDataProvider {
  readonly id = "binance";
  readonly isReal = true;

  async getHistoricalBars(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date): Promise<OHLCVBar[]> {
    const asset = await prisma.asset.findUnique({ where: { symbol: symbol.toUpperCase() } });
    if (!asset) return [];

    const rows = await prisma.marketData.findMany({
      where: {
        assetId: asset.id,
        timeframe,
        isDemo: false,
        timestamp: { gte: startDate, lte: endDate },
      },
      orderBy: { timestamp: "asc" },
    });

    return rows.map((row) => ({
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
  }
}
