import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { importHistoricalMarketData } from "../importer";
import { hourlyBars, makeBar, makeMockBinanceFetch } from "./testFixtures";

// Each describe block below uses its own disjoint historical year for its
// fixture's timestamps, all under H1/binance, so the blocks never collide
// with each other's rows in the shared test database. Every block cleans
// up exactly the rows (and import log entries) it created.
async function cleanupRange(exchangeSymbol: "BTCUSDT" | "ETHUSDT" | "SOLUSDT", internalSymbol: "BTC" | "ETH" | "SOL", timeframe: string, startMs: number, endMs: number) {
  const asset = await prisma.asset.findUnique({ where: { symbol: internalSymbol } });
  if (!asset) return;
  await prisma.marketData.deleteMany({
    where: { assetId: asset.id, timeframe, source: "binance", timestamp: { gte: new Date(startMs - 86_400_000), lte: new Date(endMs + 86_400_000) } },
  });
  await prisma.marketDataImportLog.deleteMany({
    where: { assetId: asset.id, timeframe, source: "binance", rangeStart: { gte: new Date(startMs - 86_400_000) }, rangeEnd: { lte: new Date(endMs + 86_400_000) } },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Fase 9 test #1 — paginación de Binance a través de múltiples páginas", () => {
  const startMs = Date.UTC(2016, 0, 1);
  const count = 1500; // > BINANCE_MAX_LIMIT (1000) forces at least 2 pages
  const endMs = startMs + (count - 1) * 3_600_000;

  afterAll(() => cleanupRange("BTCUSDT", "BTC", "H1", startMs, endMs));

  it("requests every candle across more than one page and inserts all of them", async () => {
    const bars = hourlyBars(startMs, count);
    const { fetchImpl, calls } = makeMockBinanceFetch(bars);

    const stats = await importHistoricalMarketData({
      exchangeSymbol: "BTCUSDT",
      timeframe: "H1",
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      fetchImpl,
    });

    expect(calls.length).toBeGreaterThan(1); // proves pagination actually happened
    expect(stats.received).toBe(count);
    expect(stats.inserted).toBe(count);
    expect(stats.status).toBe("DONE");
    expect(stats.firstTimestamp?.getTime()).toBe(startMs);
    expect(stats.lastTimestamp?.getTime()).toBe(endMs);
  });
});

describe("Fase 9 tests #2/#3 — corte exacto en endDate, jamás vela futura", () => {
  const startMs = Date.UTC(2016, 1, 1);
  const count = 24;
  const endMs = startMs + (count - 1) * 3_600_000;

  afterAll(() => cleanupRange("ETHUSDT", "ETH", "H1", startMs, endMs + 5 * 3_600_000));

  it("never inserts a candle after endDate, even when the exchange returns one anyway", async () => {
    // Simulate a misbehaving/edge-case exchange response that ignores our
    // own endTime parameter and returns bars past it — the IMPORTER itself
    // (not the mock's cooperation) must be the thing that clips this.
    const bars = hourlyBars(startMs, count + 5); // 5 extra bars past endDate
    const { fetchImpl } = makeMockBinanceFetch(bars, { ignoreEndTime: true });

    const stats = await importHistoricalMarketData({
      exchangeSymbol: "ETHUSDT",
      timeframe: "H1",
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      fetchImpl,
    });

    expect(stats.skipped).toBeGreaterThanOrEqual(5);
    expect(stats.lastTimestamp?.getTime()).toBe(endMs);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "ETH" } });
    const rowsAfterEnd = await prisma.marketData.count({
      where: { assetId: asset.id, timeframe: "H1", source: "binance", timestamp: { gt: new Date(endMs) } },
    });
    expect(rowsAfterEnd).toBe(0);
  });

  it("stops exactly at endDate — the last stored candle's timestamp equals endDate when data exists there", async () => {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "ETH" } });
    const last = await prisma.marketData.findFirst({
      where: { assetId: asset.id, timeframe: "H1", source: "binance" },
      orderBy: { timestamp: "desc" },
    });
    expect(last?.timestamp.getTime()).toBe(endMs);
  });
});

describe("Fase 9 test #4 (integración) — velas inválidas nunca se persisten", () => {
  const startMs = Date.UTC(2016, 2, 1);
  const count = 10;
  const endMs = startMs + (count - 1) * 3_600_000;

  afterAll(() => cleanupRange("SOLUSDT", "SOL", "H1", startMs, endMs));

  it("counts an OHLC-invalid candle as invalid and never writes it to MarketData", async () => {
    const bars = hourlyBars(startMs, count);
    // Corrupt one candle in the middle: high below low.
    bars[5] = makeBar(bars[5].timestamp.getTime(), 100, { high: 10, low: 20 });
    const { fetchImpl } = makeMockBinanceFetch(bars);

    const stats = await importHistoricalMarketData({
      exchangeSymbol: "SOLUSDT",
      timeframe: "H1",
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      fetchImpl,
    });

    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(count - 1);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "SOL" } });
    const corrupted = await prisma.marketData.findFirst({
      where: { assetId: asset.id, timeframe: "H1", source: "binance", timestamp: bars[5].timestamp },
    });
    expect(corrupted).toBeNull();
  });
});

describe("Fase 9 tests #5/#6 — prevención de duplicados e idempotencia", () => {
  const startMs = Date.UTC(2017, 0, 1);
  const count = 48;
  const endMs = startMs + (count - 1) * 3_600_000;

  afterAll(() => cleanupRange("BTCUSDT", "BTC", "H1", startMs, endMs));

  it("running the same import twice never creates duplicate rows and reports duplicates on the second run", async () => {
    const bars = hourlyBars(startMs, count);
    const { fetchImpl: fetchImpl1 } = makeMockBinanceFetch(bars);

    const first = await importHistoricalMarketData({
      exchangeSymbol: "BTCUSDT",
      timeframe: "H1",
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      fetchImpl: fetchImpl1,
    });
    expect(first.inserted).toBe(count);
    expect(first.duplicates).toBe(0);

    const { fetchImpl: fetchImpl2 } = makeMockBinanceFetch(bars);
    const second = await importHistoricalMarketData({
      exchangeSymbol: "BTCUSDT",
      timeframe: "H1",
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      fetchImpl: fetchImpl2,
    });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.duplicates).toBe(count);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const rowCount = await prisma.marketData.count({
      where: { assetId: asset.id, timeframe: "H1", source: "binance", timestamp: { gte: new Date(startMs), lte: new Date(endMs) } },
    });
    expect(rowCount).toBe(count); // no duplicate rows, matching the @@unique constraint
  });

  it("test #7/#11/#12 — persists MarketData rows with source='binance', isDemo=false, quality=100 and the exact OHLCV values", async () => {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const row = await prisma.marketData.findFirstOrThrow({
      where: { assetId: asset.id, timeframe: "H1", source: "binance", timestamp: new Date(startMs) },
    });
    expect(row.source).toBe("binance");
    expect(row.isDemo).toBe(false);
    expect(row.quality).toBe(100);
    expect(row.open).toBe(100);
    expect(row.close).toBe(100);
  });
});
