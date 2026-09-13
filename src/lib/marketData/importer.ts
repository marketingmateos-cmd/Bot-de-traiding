import { prisma } from "@/lib/db";
import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";
import { resolveInternalSymbol } from "./symbolMapping";
import { fetchKlinesPage, timeframeMs, BINANCE_MAX_LIMIT, type FetchLike } from "./binanceClient";
import { validateCandleBatch } from "./candleValidation";

export interface ImportHistoricalMarketDataOptions {
  exchangeSymbol: string; // e.g. "BTCUSDT" — internal symbol is DERIVED from this via symbolMapping, never accepted separately
  timeframe: TimeframeCode;
  startDate: Date;
  endDate: Date;
  fetchImpl?: FetchLike;
  onPage?: (page: OHLCVBar[]) => void;
}

export interface ImportStats {
  requested: number; // expected candle count for this range/timeframe (calendar math, not an API parameter)
  received: number; // raw candles returned by the exchange across every page
  inserted: number; // brand-new rows written
  updated: number; // existing rows whose stored values differed and were corrected
  duplicates: number; // existing rows with IDENTICAL values already stored — a true no-op re-import
  skipped: number; // candles dropped for being outside [startDate, endDate] despite being returned (defensive; should be 0 in practice)
  invalid: number; // candles that failed candleValidation and were never written
  firstTimestamp: Date | null;
  lastTimestamp: Date | null;
  status: "DONE" | "PARTIAL" | "FAILED";
  error: string | null;
  importLogId: string;
}

/**
 * Fase 9 — the only code path that writes real historical candles into
 * `MarketData`. Every row this function inserts or updates is stamped
 * `source: "binance"`, `isDemo: false` — SYNTHETIC data is never written
 * here, and this function never reads or touches anything under
 * `src/lib/providers/market-data/demo-provider.ts`.
 *
 * Idempotent by construction: re-running the exact same
 * (exchangeSymbol, timeframe, startDate, endDate) queries the existing
 * rows for that range first and only writes what's actually new or
 * changed — a second run reports `duplicates` for everything already
 * correctly stored, `inserted: 0`, and creates zero duplicate rows (the
 * DB's own `@@unique([assetId, timeframe, timestamp, source])` would
 * reject a literal duplicate insert attempt anyway, but this function
 * never even attempts one).
 */
export async function importHistoricalMarketData(options: ImportHistoricalMarketDataOptions): Promise<ImportStats> {
  const mapping = resolveInternalSymbol(options.exchangeSymbol);
  const source = mapping.exchange; // "binance"
  const stepMs = timeframeMs(options.timeframe);

  const asset = await prisma.asset.upsert({
    where: { symbol: mapping.internalSymbol },
    update: {},
    create: { symbol: mapping.internalSymbol, name: mapping.internalSymbol },
  });

  const importLog = await prisma.marketDataImportLog.create({
    data: {
      assetId: asset.id,
      timeframe: options.timeframe,
      source,
      rangeStart: options.startDate,
      rangeEnd: options.endDate,
      status: "PENDING",
    },
  });

  const requested = Math.max(0, Math.floor((options.endDate.getTime() - options.startDate.getTime()) / stepMs) + 1);

  let received = 0;
  let inserted = 0;
  let updated = 0;
  let duplicates = 0;
  let skipped = 0;
  let invalid = 0;
  let firstTimestamp: Date | null = null;
  let lastTimestamp: Date | null = null;
  let anyRowWritten = false;
  let caughtError: string | null = null;

  try {
    let cursorMs = options.startDate.getTime();
    const endMs = options.endDate.getTime();

    while (cursorMs <= endMs) {
      const page = await fetchKlinesPage(
        { exchangeSymbol: mapping.exchangeSymbol, timeframe: options.timeframe, startTimeMs: cursorMs, endTimeMs: endMs, limit: BINANCE_MAX_LIMIT },
        options.fetchImpl
      );
      if (page.length === 0) break; // exchange has nothing more in this range — stop, never loop forever
      options.onPage?.(page);
      received += page.length;

      const { valid, invalid: invalidCandles } = validateCandleBatch(page);
      invalid += invalidCandles.length;

      // Defensive truncation: never insert a candle outside the requested
      // range, even if the exchange (or a mocked test double) returns one.
      const inRange = valid.filter((bar) => bar.timestamp.getTime() >= options.startDate.getTime() && bar.timestamp.getTime() <= endMs);
      skipped += valid.length - inRange.length;

      if (inRange.length > 0) {
        const rangeStartMs = inRange[0].timestamp.getTime();
        const rangeEndMs = inRange[inRange.length - 1].timestamp.getTime();
        const existingRows = await prisma.marketData.findMany({
          where: { assetId: asset.id, timeframe: options.timeframe, source, timestamp: { gte: new Date(rangeStartMs), lte: new Date(rangeEndMs) } },
          select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
        });
        const existingByTs = new Map(existingRows.map((r) => [r.timestamp.getTime(), r]));

        for (const bar of inRange) {
          const ts = bar.timestamp.getTime();
          const existing = existingByTs.get(ts);
          if (existing) {
            const unchanged = existing.open === bar.open && existing.high === bar.high && existing.low === bar.low && existing.close === bar.close && existing.volume === bar.volume;
            if (unchanged) {
              duplicates++;
            } else {
              await prisma.marketData.update({
                where: { assetId_timeframe_timestamp_source: { assetId: asset.id, timeframe: options.timeframe, timestamp: bar.timestamp, source } },
                data: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, isDemo: false, quality: 100 },
              });
              updated++;
              anyRowWritten = true;
            }
          } else {
            await prisma.marketData.create({
              data: {
                assetId: asset.id,
                timeframe: options.timeframe,
                timestamp: bar.timestamp,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
                source,
                isDemo: false,
                quality: 100,
              },
            });
            inserted++;
            anyRowWritten = true;
          }
          if (firstTimestamp === null || bar.timestamp < firstTimestamp) firstTimestamp = bar.timestamp;
          if (lastTimestamp === null || bar.timestamp > lastTimestamp) lastTimestamp = bar.timestamp;
        }
      }

      const lastReceivedMs = page[page.length - 1].timestamp.getTime();
      const nextCursor = lastReceivedMs + stepMs;
      if (nextCursor <= cursorMs) break; // safety: never spin in place if the exchange returns a non-advancing page
      cursorMs = nextCursor;
    }
  } catch (err) {
    caughtError = err instanceof Error ? err.message : String(err);
  }

  const status: ImportStats["status"] = caughtError ? (anyRowWritten ? "PARTIAL" : "FAILED") : "DONE";

  await prisma.marketDataImportLog.update({
    where: { id: importLog.id },
    data: {
      rowsRequested: requested,
      rowsReceived: received,
      rowsInserted: inserted,
      rowsUpdated: updated,
      rowsSkipped: skipped + duplicates,
      rowsInvalid: invalid,
      status,
      error: caughtError,
    },
  });

  return { requested, received, inserted, updated, duplicates, skipped, invalid, firstTimestamp, lastTimestamp, status, error: caughtError, importLogId: importLog.id };
}
