import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prisma } from "@/lib/db";
import { MT5DemoExecutionAdapter } from "@/lib/execution/mt5DemoExecutionAdapter";
import { makeFakeMt5Client, DEMO_ACCOUNT, LIVE_ACCOUNT } from "@/lib/execution/__tests__/testFixtures";
import { setSymbolMapping } from "@/lib/execution/mt5SymbolMapper";
import { ingestMt5HistoricalData, Mt5NotDemoError, Mt5SymbolUnavailableError, MT5_DEFAULT_SOURCE } from "../mt5HistoricalIngestion";
import type { Mt5HistoricalBar } from "@/lib/execution/types";

const SYMBOL = "EURUSD_INGEST_TEST";

function bar(iso: string, o: number, h: number, l: number, c: number, v: number): Mt5HistoricalBar {
  return { timestamp: new Date(iso), open: o, high: h, low: l, close: c, volume: v, tickVolume: v, spread: 2, realVolume: 0 };
}

async function cleanup() {
  await prisma.mt5SymbolMapping.deleteMany({ where: { edgeLabSymbol: SYMBOL } });
  const asset = await prisma.asset.findUnique({ where: { symbol: SYMBOL } });
  if (asset) {
    await prisma.marketData.deleteMany({ where: { assetId: asset.id } });
    await prisma.marketDataImportLog.deleteMany({ where: { assetId: asset.id } });
    await prisma.researchDataset.deleteMany({ where: { symbol: SYMBOL } });
  }
}

beforeEach(async () => {
  await cleanup();
  await setSymbolMapping(SYMBOL, "EURUSDm");
});
afterEach(cleanup);

describe("MT5 Data Connector — ingestMt5HistoricalData (full pipeline over a fake adapter)", () => {
  it("connects, verifies demo, resolves symbol, fetches bars, persists, and registers a ResearchDataset", async () => {
    const bars = [bar("2024-01-01T00:00:00.000Z", 1.1, 1.12, 1.09, 1.11, 100), bar("2024-01-01T01:00:00.000Z", 1.11, 1.13, 1.1, 1.12, 120)];
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSDm"], historicalRates: async () => bars }));
    await adapter.connect({ login: "1", password: "x", server: "Demo" });

    const result = await ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date("2024-01-01T00:00:00.000Z"), endDate: new Date("2024-01-01T02:00:00.000Z") });

    expect(result.mt5Symbol).toBe("EURUSDm");
    expect(result.importStats.status).toBe("DONE");
    expect(result.importStats.inserted).toBe(2);
    expect(result.dataset).not.toBeNull();
    expect(result.dataset?.source).toBe(MT5_DEFAULT_SOURCE);
    expect(result.dataset?.isDemo).toBe(false);
    expect(result.dataset?.rowCount).toBe(2);
    expect(result.dataset?.datasetHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses (throws Mt5NotDemoError) for a LIVE account, before ever calling getHistoricalBars", async () => {
    let historicalRatesCalled = false;
    const adapter = new MT5DemoExecutionAdapter(
      makeFakeMt5Client({
        accountInfo: async () => LIVE_ACCOUNT,
        symbols: async () => ["EURUSDm"],
        historicalRates: async () => {
          historicalRatesCalled = true;
          return [];
        },
      })
    );
    await adapter.connect({ login: "1", password: "x", server: "Live" });

    await expect(ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date(), endDate: new Date() })).rejects.toThrow(Mt5NotDemoError);
    expect(historicalRatesCalled).toBe(false);

    const asset = await prisma.asset.findUnique({ where: { symbol: SYMBOL } });
    const count = asset ? await prisma.marketData.count({ where: { assetId: asset.id } }) : 0;
    expect(count).toBe(0); // nothing ingested for a live account, ever
  });

  it("refuses (throws Mt5SymbolUnavailableError) when the mapped symbol isn't on the live terminal — never invents one", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ accountInfo: async () => DEMO_ACCOUNT, symbols: async () => ["SOMETHING_ELSE"] }));
    await adapter.connect({ login: "1", password: "x", server: "Demo" });

    await expect(ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date(), endDate: new Date() })).rejects.toThrow(Mt5SymbolUnavailableError);
  });

  it("is idempotent — ingesting the identical range twice produces the same rowCount/hash, no duplicates", async () => {
    const bars = [bar("2024-02-01T00:00:00.000Z", 1.2, 1.22, 1.19, 1.21, 50)];
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSDm"], historicalRates: async () => bars }));
    await adapter.connect({ login: "1", password: "x", server: "Demo" });

    const first = await ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date("2024-02-01T00:00:00.000Z"), endDate: new Date("2024-02-01T01:00:00.000Z") });
    const second = await ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date("2024-02-01T00:00:00.000Z"), endDate: new Date("2024-02-01T01:00:00.000Z") });

    expect(first.importStats.inserted).toBe(1);
    expect(second.importStats.inserted).toBe(0);
    expect(second.importStats.duplicates).toBe(1);
    expect(first.dataset?.id).toBe(second.dataset?.id); // same registered dataset row, not a new one
    expect(first.dataset?.datasetHash).toBe(second.dataset?.datasetHash);
  });

  it("rejects invalid OHLC bars via the same validateCandleBatch every other importer uses — never registers a dataset over garbage rows", async () => {
    const badBars = [{ ...bar("2024-03-01T00:00:00.000Z", 1.2, 1.15, 1.25, 1.18, 50) }]; // high < low
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSDm"], historicalRates: async () => badBars }));
    await adapter.connect({ login: "1", password: "x", server: "Demo" });

    const result = await ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date("2024-03-01T00:00:00.000Z"), endDate: new Date("2024-03-01T01:00:00.000Z") });
    expect(result.importStats.invalid).toBe(1);
    expect(result.importStats.inserted).toBe(0);
    expect(result.dataset).toBeNull();
  });

  it("registers under the MT5-specific source, never mixed with a Binance dataset for the same symbol/timeframe", async () => {
    const bars = [bar("2024-04-01T00:00:00.000Z", 1.3, 1.32, 1.29, 1.31, 10)];
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSDm"], historicalRates: async () => bars }));
    await adapter.connect({ login: "1", password: "x", server: "Demo" });

    await ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date("2024-04-01T00:00:00.000Z"), endDate: new Date("2024-04-01T01:00:00.000Z") });

    const datasets = await prisma.researchDataset.findMany({ where: { symbol: SYMBOL } });
    expect(datasets).toHaveLength(1);
    expect(datasets[0].source).toBe("mt5_demo");
    expect(datasets[0].source).not.toBe("binance");
    expect(datasets[0].source).not.toMatch(/binance/);
  });
});

describe("MT5 Data Connector — UTC normalization and gap detection (spec section 10)", () => {
  it("timestamps are stored and read back as UTC instants — a bar's timestamp round-trips exactly through Date/Prisma", async () => {
    const bars = [bar("2024-05-01T13:00:00.000Z", 1.25, 1.27, 1.24, 1.26, 30)];
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSDm"], historicalRates: async () => bars }));
    await adapter.connect({ login: "1", password: "x", server: "Demo" });

    await ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date("2024-05-01T13:00:00.000Z"), endDate: new Date("2024-05-01T14:00:00.000Z") });

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: SYMBOL } });
    const row = await prisma.marketData.findFirstOrThrow({ where: { assetId: asset.id, timeframe: "H1" } });
    expect(row.timestamp.toISOString()).toBe("2024-05-01T13:00:00.000Z");
  });

  it("a real gap in the MT5-provided bars (a missing hour) is registered as gapCount=1, never silently filled", async () => {
    // Two H1 bars with a missing hour in between (00:00 and 02:00, no 01:00).
    const bars = [bar("2024-06-01T00:00:00.000Z", 1.1, 1.11, 1.09, 1.1, 10), bar("2024-06-01T02:00:00.000Z", 1.1, 1.12, 1.09, 1.11, 15)];
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSDm"], historicalRates: async () => bars }));
    await adapter.connect({ login: "1", password: "x", server: "Demo" });

    const result = await ingestMt5HistoricalData(adapter, { edgeLabSymbol: SYMBOL, timeframe: "H1", startDate: new Date("2024-06-01T00:00:00.000Z"), endDate: new Date("2024-06-01T03:00:00.000Z") });

    expect(result.dataset?.rowCount).toBe(2);
    expect(result.dataset?.gapCount).toBe(1); // the missing 01:00 bar — registered, never fabricated
  });
});

describe("MT5 Data Connector — structural: ingestion path never calls placeOrder/orderSend", () => {
  it("mt5HistoricalIngestion.ts's own source never CALLS placeOrder(...) or orderSend(...) — a doc comment merely naming them is fine, an actual call is not", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "..", "mt5HistoricalIngestion.ts"), "utf8");
    expect(source).not.toMatch(/\.placeOrder\(/);
    expect(source).not.toMatch(/\.orderSend\(/);
  });
});
