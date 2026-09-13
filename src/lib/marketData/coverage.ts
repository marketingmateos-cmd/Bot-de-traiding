import { prisma } from "@/lib/db";
import type { TimeframeCode } from "@/lib/providers/types";
import { timeframeMs } from "./binanceClient";

export interface MarketDataGap {
  afterTimestamp: string; // ISO — the last candle before the gap
  beforeTimestamp: string; // ISO — the first candle after the gap
  missingCandles: number; // real, unfilled — never synthesized
}

export interface MarketDataCoverageReport {
  symbol: string;
  timeframe: TimeframeCode;
  /**
   * Fase 9.1.11 — the REAL, distinct `MarketData.source` values the rows
   * below actually came from (deduplicated, sorted). When `rowCount` is 0
   * this instead echoes the normalized requested filter (so a caller can
   * still see what it asked for), never a fabricated guess. Renamed from
   * a single `source: string` — a report can genuinely span more than one
   * real import path (e.g. a live-API backfill plus a CSV import) and
   * must show all of them, never arbitrarily pick one.
   */
  sources: string[];
  rowCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  coveragePct: number | null; // rowCount / expected-if-no-gaps, null when rowCount is 0
  avgQuality: number | null; // mean of MarketData.quality across the rows found, null when rowCount is 0
  gaps: MarketDataGap[];
}

/**
 * Fase 9.6/9.1.11 — reports the REAL state of `MarketData` for one
 * (symbol, timeframe), across one, several, or (by default) ALL real
 * `source` values found: first/last candle, row count, and every genuine
 * gap (a real hole in the exchange's own history, or in what's been
 * imported so far) — never filled in, only reported, per the explicit
 * rule that historical gaps must stay honest.
 *
 * `source` is optional and mirrors `DbBackedHistoricalMarketDataProvider`'s
 * own behavior exactly: omit it entirely to see coverage across every real
 * import path for this asset/timeframe (the same "any real row counts"
 * rule the replay pipeline itself uses); pass one string to scope to a
 * single known source; pass an array to scope to a specific known set.
 * Always `isDemo: false` — a demo/synthetic row is never counted here
 * regardless of what's passed as `source`.
 */
export async function computeMarketDataCoverage(symbol: string, timeframe: TimeframeCode, source?: string | string[]): Promise<MarketDataCoverageReport> {
  const requestedSources = source === undefined ? [] : Array.from(new Set(Array.isArray(source) ? source : [source])).sort();

  const asset = await prisma.asset.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!asset) {
    return { symbol: symbol.toUpperCase(), timeframe, sources: requestedSources, rowCount: 0, firstTimestamp: null, lastTimestamp: null, coveragePct: null, avgQuality: null, gaps: [] };
  }

  const rows = await prisma.marketData.findMany({
    where: { assetId: asset.id, timeframe, isDemo: false, ...(source !== undefined ? { source: Array.isArray(source) ? { in: source } : source } : {}) },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, quality: true, source: true },
  });

  if (rows.length === 0) {
    return { symbol: symbol.toUpperCase(), timeframe, sources: requestedSources, rowCount: 0, firstTimestamp: null, lastTimestamp: null, coveragePct: null, avgQuality: null, gaps: [] };
  }

  const foundSources = Array.from(new Set(rows.map((r) => r.source))).sort();

  const stepMs = timeframeMs(timeframe);
  const gaps: MarketDataGap[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prevMs = rows[i - 1].timestamp.getTime();
    const curMs = rows[i].timestamp.getTime();
    const missing = Math.round((curMs - prevMs) / stepMs) - 1;
    if (missing > 0) {
      gaps.push({ afterTimestamp: rows[i - 1].timestamp.toISOString(), beforeTimestamp: rows[i].timestamp.toISOString(), missingCandles: missing });
    }
  }

  const first = rows[0].timestamp;
  const last = rows[rows.length - 1].timestamp;
  const expectedIfNoGaps = Math.round((last.getTime() - first.getTime()) / stepMs) + 1;
  const coveragePct = expectedIfNoGaps > 0 ? (rows.length / expectedIfNoGaps) * 100 : null;
  const avgQuality = rows.reduce((sum, r) => sum + r.quality, 0) / rows.length;

  return {
    symbol: symbol.toUpperCase(),
    timeframe,
    sources: foundSources,
    rowCount: rows.length,
    firstTimestamp: first.toISOString(),
    lastTimestamp: last.toISOString(),
    coveragePct,
    avgQuality,
    gaps,
  };
}
