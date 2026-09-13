import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DbBackedHistoricalMarketDataProvider } from "../historicalMarketDataProvider";

const startMs = Date.UTC(2018, 0, 1);
const count = 20;
const stepMs = 3_600_000;
const endMs = startMs + (count - 1) * stepMs;

let assetId: string;

beforeAll(async () => {
  const asset = await prisma.asset.upsert({ where: { symbol: "BTC" }, update: {}, create: { symbol: "BTC", name: "Bitcoin" } });
  assetId = asset.id;

  // Seed REAL rows (source: binance, isDemo: false) directly — this test
  // targets the provider's own read path, not the importer.
  for (let i = 0; i < count; i++) {
    await prisma.marketData.create({
      data: {
        assetId,
        timeframe: "H1",
        timestamp: new Date(startMs + i * stepMs),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 10,
        source: "binance",
        isDemo: false,
        quality: 100,
      },
    });
  }

  // Seed a DEMO/SYNTHETIC row in the exact same range, on purpose, to prove
  // it never leaks into the real provider's results (test #15).
  await prisma.marketData.create({
    data: {
      assetId,
      timeframe: "H1",
      timestamp: new Date(startMs + 3 * stepMs),
      open: 999,
      high: 999,
      low: 999,
      close: 999,
      volume: 0,
      source: "demo",
      isDemo: true,
      quality: 100,
    },
  });
});

afterAll(async () => {
  await prisma.marketData.deleteMany({ where: { assetId, timeframe: "H1", timestamp: { gte: new Date(startMs), lte: new Date(endMs) } } });
  await prisma.$disconnect();
});

describe("Fase 9 test #8 — DbBackedHistoricalMarketDataProvider", () => {
  it("returns exactly the real rows in the range, strictly ascending by timestamp", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const bars = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), new Date(endMs));

    expect(bars).toHaveLength(count);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].timestamp.getTime()).toBeGreaterThan(bars[i - 1].timestamp.getTime());
    }
    expect(bars[0].open).toBe(100);
  });

  it("returns an empty array for an unknown symbol rather than throwing or fabricating data", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const bars = await provider.getHistoricalBars("NOPE", "H1", new Date(startMs), new Date(endMs));
    expect(bars).toEqual([]);
  });

  it("respects the requested date range (excludes bars outside [startDate, endDate])", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const narrowEnd = new Date(startMs + 2 * stepMs);
    const bars = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), narrowEnd);
    expect(bars).toHaveLength(3);
  });
});

describe("Fase 9 test #15 — aislamiento: datos SYNTHETIC/demo nunca contaminan HISTORICAL_REAL", () => {
  it("never returns the isDemo:true row even though it falls inside the requested range", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const bars = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), new Date(endMs));
    const contaminated = bars.some((b) => b.open === 999);
    expect(contaminated).toBe(false);
    expect(bars).toHaveLength(count); // exactly the real rows, not count+1
  });
});
