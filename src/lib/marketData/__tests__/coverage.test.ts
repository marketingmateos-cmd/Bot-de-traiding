import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { computeMarketDataCoverage } from "../coverage";

const startMs = Date.UTC(2019, 0, 1);
const stepMs = 3_600_000;

let assetId: string;
// Timestamps with a deliberate 3-candle gap between index 4 and index 8,
// and another single-candle gap between index 10 and 12.
const presentIndices = [0, 1, 2, 3, 4, 8, 9, 10, 12, 13];

beforeAll(async () => {
  const asset = await prisma.asset.upsert({ where: { symbol: "ETH" }, update: {}, create: { symbol: "ETH", name: "Ethereum" } });
  assetId = asset.id;

  for (const i of presentIndices) {
    await prisma.marketData.create({
      data: {
        assetId,
        timeframe: "H1",
        timestamp: new Date(startMs + i * stepMs),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 10,
        source: "binance",
        isDemo: false,
        quality: 100,
      },
    });
  }
});

afterAll(async () => {
  await prisma.marketData.deleteMany({ where: { assetId, timeframe: "H1", source: "binance", timestamp: { gte: new Date(startMs), lte: new Date(startMs + 20 * stepMs) } } });
  await prisma.$disconnect();
});

describe("Fase 9 test #13 — huecos reales detectados, nunca rellenados", () => {
  it("reports the exact row count, first/last timestamp, and every real gap", async () => {
    const report = await computeMarketDataCoverage("ETH", "H1", "binance");

    expect(report.rowCount).toBe(presentIndices.length);
    expect(report.firstTimestamp).toBe(new Date(startMs).toISOString());
    expect(report.lastTimestamp).toBe(new Date(startMs + 13 * stepMs).toISOString());

    expect(report.gaps).toHaveLength(2);
    expect(report.gaps[0].missingCandles).toBe(3); // indices 5,6,7 missing
    expect(report.gaps[1].missingCandles).toBe(1); // index 11 missing

    // coverage% must be strictly less than 100 given the real gaps, and
    // never silently "fixed" to 100 by filling anything in.
    expect(report.coveragePct).not.toBeNull();
    expect(report.coveragePct!).toBeLessThan(100);
    expect(report.avgQuality).toBe(100);
  });

  it("reports zero rows and null coverage/quality for an asset/timeframe with nothing imported", async () => {
    const report = await computeMarketDataCoverage("ETH", "D1", "binance");
    expect(report.rowCount).toBe(0);
    expect(report.coveragePct).toBeNull();
    expect(report.avgQuality).toBeNull();
    expect(report.gaps).toEqual([]);
  });
});
