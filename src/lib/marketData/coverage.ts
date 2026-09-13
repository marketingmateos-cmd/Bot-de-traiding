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
  source: string;
  rowCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  coveragePct: number | null; // rowCount / expected-if-no-gaps, null when rowCount is 0
  avgQuality: number | null; // mean of MarketData.quality across the rows found, null when rowCount is 0
  gaps: MarketDataGap[];
}

/**
 * Fase 9.6 — reports the REAL state of `MarketData` for one (symbol,
 * timeframe, source): first/last candle, row count, and every genuine gap
 * (a real hole in the exchange's own history, or in what's been imported
 * so far) — never filled in, only reported, per the explicit rule that
 * historical gaps must stay honest.
 */
export async function computeMarketDataCoverage(symbol: string, timeframe: TimeframeCode, source = "binance"): Promise<MarketDataCoverageReport> {
  const asset = await prisma.asset.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!asset) {
    return { symbol: symbol.toUpperCase(), timeframe, source, rowCount: 0, firstTimestamp: null, lastTimestamp: null, coveragePct: null, avgQuality: null, gaps: [] };
  }

  const rows = await prisma.marketData.findMany({
    where: { assetId: asset.id, timeframe, source, isDemo: false },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, quality: true },
  });

  if (rows.length === 0) {
    return { symbol: symbol.toUpperCase(), timeframe, source, rowCount: 0, firstTimestamp: null, lastTimestamp: null, coveragePct: null, avgQuality: null, gaps: [] };
  }

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
    source,
    rowCount: rows.length,
    firstTimestamp: first.toISOString(),
    lastTimestamp: last.toISOString(),
    coveragePct,
    avgQuality,
    gaps,
  };
}
