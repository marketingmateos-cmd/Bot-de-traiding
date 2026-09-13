import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getHistoricalBars } from "../historicalDataProvider";
import { barsAsOf } from "../replayClock";

const startMs = Date.UTC(2020, 0, 1);
const stepMs = 3_600_000;
const count = 30;
const endMs = startMs + (count - 1) * stepMs;

let assetId: string;

beforeAll(async () => {
  const asset = await prisma.asset.upsert({ where: { symbol: "SOL" }, update: {}, create: { symbol: "SOL", name: "Solana" } });
  assetId = asset.id;
});

afterAll(async () => {
  await prisma.marketData.deleteMany({ where: { assetId, timeframe: "H1", source: "binance", timestamp: { gte: new Date(startMs), lte: new Date(endMs) } } });
  await prisma.$disconnect();
});

describe("Fase 9 test #9 — disponibilidad honesta de HISTORICAL_REAL", () => {
  it("reports available:false, source:'unavailable' when nothing has been imported for this range", async () => {
    const result = await getHistoricalBars("SOL", "H1", new Date(startMs), new Date(endMs), "HISTORICAL_REAL");
    expect(result.available).toBe(false);
    expect(result.source).toBe("unavailable");
    expect(result.bars).toEqual([]);
  });

  it("reports available:true, source:'binance', marketData=REAL once real candles have been imported", async () => {
    for (let i = 0; i < count; i++) {
      await prisma.marketData.create({
        data: {
          assetId,
          timeframe: "H1",
          timestamp: new Date(startMs + i * stepMs),
          open: 20 + i,
          high: 21 + i,
          low: 19 + i,
          close: 20.5 + i,
          volume: 5,
          source: "binance",
          isDemo: false,
          quality: 100,
        },
      });
    }

    const result = await getHistoricalBars("SOL", "H1", new Date(startMs), new Date(endMs), "HISTORICAL_REAL");
    expect(result.available).toBe(true);
    expect(result.source).toBe("binance"); // never "synthetic" for real data
    expect(result.bars).toHaveLength(count);
  });
});

describe("Fase 9 test #10 — anti-look-ahead sobre datos REALES (barsAsOf nunca ve timestamp > T)", () => {
  it("barsAsOf(realBars, T) never returns a bar with timestamp greater than T, for several T values", async () => {
    const result = await getHistoricalBars("SOL", "H1", new Date(startMs), new Date(endMs), "HISTORICAL_REAL");
    expect(result.available).toBe(true);

    const checkpoints = [startMs, startMs + 5 * stepMs, startMs + 15 * stepMs, endMs];
    for (const asOfMs of checkpoints) {
      const visible = barsAsOf(result.bars, asOfMs);
      for (const bar of visible) {
        expect(bar.timestamp.getTime()).toBeLessThanOrEqual(asOfMs);
      }
      const expectedCount = Math.floor((asOfMs - startMs) / stepMs) + 1;
      expect(visible).toHaveLength(expectedCount);
    }
  });

  it("barsAsOf at a timestamp BEFORE the first real candle returns nothing (no leakage backward either)", async () => {
    const result = await getHistoricalBars("SOL", "H1", new Date(startMs), new Date(endMs), "HISTORICAL_REAL");
    const visible = barsAsOf(result.bars, startMs - stepMs);
    expect(visible).toHaveLength(0);
  });
});

describe("Fase 9 test #16 — el modo SYNTHETIC sigue funcionando sin cambios", () => {
  it("still returns deterministic synthetic bars, tagged source:'synthetic', unaffected by Fase 9", async () => {
    const result = await getHistoricalBars("SOL", "H1", new Date(startMs), new Date(endMs), "SYNTHETIC");
    expect(result.available).toBe(true);
    expect(result.source).toBe("synthetic");
    expect(result.bars.length).toBeGreaterThan(0);
  });

  it("SYNTHETIC bars are reproducible for the same (symbol, timeframe, range)", async () => {
    const a = await getHistoricalBars("SOL", "H1", new Date(startMs), new Date(endMs), "SYNTHETIC");
    const b = await getHistoricalBars("SOL", "H1", new Date(startMs), new Date(endMs), "SYNTHETIC");
    expect(a.bars.map((x) => x.close)).toEqual(b.bars.map((x) => x.close));
  });
});
