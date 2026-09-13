import type { OHLCVBar } from "@/lib/providers/types";
import type { FetchLike } from "../binanceClient";

/**
 * Fase 9 — builds a deterministic, in-memory stand-in for Binance's
 * `/api/v3/klines` endpoint. Every test in this suite injects one of these
 * as `fetchImpl` instead of the real `fetch` — nothing in this test suite
 * ever touches the network.
 */
export function makeBar(timestampMs: number, close: number, overrides: Partial<OHLCVBar> = {}): OHLCVBar {
  return {
    timestamp: new Date(timestampMs),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
    ...overrides,
  };
}

export function hourlyBars(startMs: number, count: number, basePrice = 100): OHLCVBar[] {
  const stepMs = 60 * 60_000;
  return Array.from({ length: count }, (_, i) => makeBar(startMs + i * stepMs, basePrice + i));
}

function barToRawKline(bar: OHLCVBar): unknown[] {
  return [
    bar.timestamp.getTime(),
    String(bar.open),
    String(bar.high),
    String(bar.low),
    String(bar.close),
    String(bar.volume),
    bar.timestamp.getTime() + 3_600_000 - 1,
    "0",
    0,
    "0",
    "0",
    "0",
  ];
}

export interface MockBinanceOptions {
  /** Simulates a server that ignores the requested endTime and returns bars past it (tests the IMPORTER's own defensive clipping, not the mock's honesty). */
  ignoreEndTime?: boolean;
}

/**
 * `allBars` must be pre-sorted ascending. The returned `fetchImpl` behaves
 * like Binance's real klines endpoint: filters to [startTime,endTime],
 * returns at most `limit` candles ordered ascending. `calls` records every
 * request made, so pagination itself can be asserted on.
 */
export function makeMockBinanceFetch(allBars: OHLCVBar[], options: MockBinanceOptions = {}): { fetchImpl: FetchLike; calls: URL[] } {
  const calls: URL[] = [];
  const fetchImpl: FetchLike = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const startTime = Number(url.searchParams.get("startTime"));
    const endTime = Number(url.searchParams.get("endTime"));
    const limit = Number(url.searchParams.get("limit"));

    const inRange = allBars.filter((bar) => {
      const t = bar.timestamp.getTime();
      if (t < startTime) return false;
      if (!options.ignoreEndTime && t > endTime) return false;
      return true;
    });
    const page = inRange.slice(0, limit);

    return {
      ok: true,
      status: 200,
      json: async () => page.map(barToRawKline),
      text: async () => JSON.stringify(page.map(barToRawKline)),
    } as Response;
  }) as FetchLike;

  return { fetchImpl, calls };
}

export function makeFailingFetch(status: number, body: string): FetchLike {
  return (async () => ({
    ok: false,
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => body,
  })) as unknown as FetchLike;
}
