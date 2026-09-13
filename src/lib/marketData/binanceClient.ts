import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";

/**
 * Fase 9 — a thin, pure client for Binance's PUBLIC (no API key, no
 * authentication, read-only) `/api/v3/klines` endpoint. Deliberately the
 * ONLY network call in this whole feature — nothing here can place an
 * order, this project remains exclusively paper trading / research.
 *
 * `fetchImpl` is injectable so every test can run against a fixture/mock
 * response instead of the real network (see __tests__/binanceClient.test.ts) —
 * this module itself never imports `fetch` implicitly beyond the default
 * parameter, so nothing here can accidentally reach the internet during a
 * test run.
 */

export const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";
export const BINANCE_MAX_LIMIT = 1000; // Binance's own documented max candles per request

const TIMEFRAME_TO_BINANCE_INTERVAL: Record<TimeframeCode, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
};

const TIMEFRAME_MS: Record<TimeframeCode, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

export type FetchLike = typeof fetch;

// Binance's raw kline array shape, per its own public docs:
// [openTime, open, high, low, close, volume, closeTime, ...unused]
type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

export interface FetchKlinesPageParams {
  exchangeSymbol: string;
  timeframe: TimeframeCode;
  startTimeMs: number;
  endTimeMs: number;
  limit?: number;
}

export class BinanceApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Binance API respondió ${status}: ${body}`);
    this.name = "BinanceApiError";
  }
}

/** Fetches ONE page (<= limit candles) — pagination across pages is the caller's (the importer's) job, see Fase 9.4. */
export async function fetchKlinesPage(params: FetchKlinesPageParams, fetchImpl: FetchLike = fetch): Promise<OHLCVBar[]> {
  const interval = TIMEFRAME_TO_BINANCE_INTERVAL[params.timeframe];
  const limit = params.limit ?? BINANCE_MAX_LIMIT;
  const url = new URL(BINANCE_KLINES_URL);
  url.searchParams.set("symbol", params.exchangeSymbol.toUpperCase());
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", String(params.startTimeMs));
  url.searchParams.set("endTime", String(params.endTimeMs));
  url.searchParams.set("limit", String(limit));

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new BinanceApiError(response.status, body);
  }
  const raw = (await response.json()) as RawKline[];
  return raw.map(rawKlineToBar);
}

function rawKlineToBar(kline: RawKline): OHLCVBar {
  const [openTime, open, high, low, close, volume] = kline;
  return {
    timestamp: new Date(openTime),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  };
}

export function timeframeToBinanceInterval(timeframe: TimeframeCode): string {
  return TIMEFRAME_TO_BINANCE_INTERVAL[timeframe];
}

export function timeframeMs(timeframe: TimeframeCode): number {
  return TIMEFRAME_MS[timeframe];
}
