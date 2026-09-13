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
    const { bars } = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), new Date(endMs));

    expect(bars).toHaveLength(count);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].timestamp.getTime()).toBeGreaterThan(bars[i - 1].timestamp.getTime());
    }
    expect(bars[0].open).toBe(100);
  });

  it("returns an empty array for an unknown symbol rather than throwing or fabricating data", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const { bars, realSources } = await provider.getHistoricalBars("NOPE", "H1", new Date(startMs), new Date(endMs));
    expect(bars).toEqual([]);
    expect(realSources).toEqual([]);
  });

  it("respects the requested date range (excludes bars outside [startDate, endDate])", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const narrowEnd = new Date(startMs + 2 * stepMs);
    const { bars } = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), narrowEnd);
    expect(bars).toHaveLength(3);
  });
});

describe("Fase 9.1.11 — realSources: la procedencia real nunca se pierde ni se inventa", () => {
  it("A) reports the exact real source(s) found — 'binance' for this fixture's seeded rows", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const { realSources } = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), new Date(endMs));
    expect(realSources).toEqual(["binance"]);
  });

  it("H) when a range genuinely mixes multiple real sources, realSources reports ALL of them, deduplicated and sorted — never picks one arbitrarily", async () => {
    // Seed one extra row under a second, distinct real source, inside the
    // same range as the fixture's 20 "binance" rows above.
    const mixedTs = new Date(startMs + count * stepMs); // one step past the fixture's own range, still real/isDemo:false
    await prisma.marketData.create({
      data: { assetId, timeframe: "H1", timestamp: mixedTs, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1, source: "binance_csv", isDemo: false, quality: 100 },
    });

    const provider = new DbBackedHistoricalMarketDataProvider();
    const { bars, realSources } = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), mixedTs);
    expect(bars).toHaveLength(count + 1); // both sources' rows are present — never dropped
    expect(realSources).toEqual(["binance", "binance_csv"]); // deduplicated, stable (sorted) order, nothing hidden

    await prisma.marketData.deleteMany({ where: { assetId, timeframe: "H1", source: "binance_csv", timestamp: mixedTs } });
  });
});

describe("Fase 9 test #15 — aislamiento: datos SYNTHETIC/demo nunca contaminan HISTORICAL_REAL", () => {
  it("never returns the isDemo:true row even though it falls inside the requested range", async () => {
    const provider = new DbBackedHistoricalMarketDataProvider();
    const { bars } = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), new Date(endMs));
    const contaminated = bars.some((b) => b.open === 999);
    expect(contaminated).toBe(false);
    expect(bars).toHaveLength(count); // exactly the real rows, not count+1
  });
});
