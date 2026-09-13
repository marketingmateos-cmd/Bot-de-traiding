import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { importHistoricalMarketDataFromFile, CSV_HEADER } from "../offlineImporter";
import { computeMarketDataCoverage } from "../coverage";
import { DbBackedHistoricalMarketDataProvider } from "../historicalMarketDataProvider";
import { getHistoricalBars } from "@/lib/replay/historicalDataProvider";
import { barsAsOf } from "@/lib/replay/replayClock";
import { executeReplay } from "@/lib/replay/executeAndPersistReplay";
import type { ReplayConfig } from "@/lib/replay/types";

// Fase 9.1 — every test here uses its own on-disk fixture CSV (deleted in
// afterAll) and its own disjoint historical year, so it never collides
// with the live-API importer's tests (which use 2016-2020) or with a real
// import a human might run against dev.db.
const tempFiles: string[] = [];
function writeCsv(name: string, rows: string[][]): string {
  const path = join(tmpdir(), `offline-importer-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  const content = [CSV_HEADER.join(","), ...rows.map((r) => r.join(","))].join("\n");
  writeFileSync(path, content, "utf-8");
  tempFiles.push(path);
  return path;
}
function writeRawCsv(name: string, content: string): string {
  const path = join(tmpdir(), `offline-importer-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(path, content, "utf-8");
  tempFiles.push(path);
  return path;
}

async function cleanupRange(internalSymbol: string, timeframe: string, source: string, startMs: number, endMs: number) {
  const asset = await prisma.asset.findUnique({ where: { symbol: internalSymbol } });
  if (!asset) return;
  await prisma.marketData.deleteMany({ where: { assetId: asset.id, timeframe, source, timestamp: { gte: new Date(startMs - 86_400_000), lte: new Date(endMs + 86_400_000) } } });
  await prisma.marketDataImportLog.deleteMany({ where: { assetId: asset.id, timeframe, source } });
}

afterAll(async () => {
  for (const f of tempFiles) {
    try {
      unlinkSync(f);
    } catch {
      /* already gone */
    }
  }
  await prisma.$disconnect();
});

const SOURCE = "binance_csv_test";

describe("Fase 9.1 test #1 — CSV válido se importa correctamente", () => {
  const startMs = Date.UTC(2015, 0, 1);
  afterAll(() => cleanupRange("BTC", "H1", SOURCE, startMs, startMs + 2 * 3_600_000));

  it("parses a well-formed ISO-8601 CSV and persists every row", async () => {
    const file = writeCsv("valid", [
      ["2015-01-01T00:00:00Z", "100", "101", "99", "100.5", "10"],
      ["2015-01-01T01:00:00Z", "100.5", "102", "100", "101", "12"],
      ["2015-01-01T02:00:00Z", "101", "103", "100.5", "102", "11"],
    ]);
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.status).toBe("DONE");
    expect(stats.rowsRead).toBe(3);
    expect(stats.rowsValid).toBe(3);
    expect(stats.inserted).toBe(3);
    expect(stats.invalid).toBe(0);
  });
});

describe("Fase 9.1 test #2 — CSV vacío", () => {
  it("a header-only CSV (zero data rows) imports cleanly with zero rows, never fabricating data", async () => {
    const file = writeCsv("empty-header-only", []);
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "ETHUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.status).toBe("DONE");
    expect(stats.rowsRead).toBe(0);
    expect(stats.inserted).toBe(0);
  });

  it("a completely empty file (no header at all) fails loudly (status FAILED, explicit error) instead of silently importing nothing", async () => {
    const file = writeRawCsv("empty-file", "");
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "ETHUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.status).toBe("FAILED");
    expect(stats.error).toMatch(/CSV vacío/i);
    expect(stats.inserted).toBe(0);
  });

  it("rejects a file whose header doesn't match the documented format", async () => {
    const file = writeRawCsv("bad-header", "time,o,h,l,c,vol\n1,2,3,4,5,6");
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "ETHUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.status).toBe("FAILED");
    expect(stats.error).toMatch(/[Cc]abecera/);
    expect(stats.inserted).toBe(0);
  });
});

describe("Fase 9.1 test #3 — OHLC inválido nunca se persiste", () => {
  const startMs = Date.UTC(2015, 1, 1);
  afterAll(() => cleanupRange("SOL", "H1", SOURCE, startMs, startMs + 3_600_000));

  it("a row with high < low is counted invalid and never written to MarketData", async () => {
    const file = writeCsv("bad-ohlc", [["2015-02-01T00:00:00Z", "100", "50", "60", "55", "10"]]);
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "SOLUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(0);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "SOL" } });
    const row = await prisma.marketData.findFirst({ where: { assetId: asset.id, timeframe: "H1", source: SOURCE, timestamp: new Date(startMs) } });
    expect(row).toBeNull();
  });
});

describe("Fase 9.1 test #4 — timestamp inválido/ambiguo nunca se adivina", () => {
  it("rejects a garbage timestamp string", async () => {
    const file = writeRawCsv("bad-ts", "timestamp,open,high,low,close,volume\nnot-a-date,100,101,99,100,10");
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(0);
  });

  it("rejects an 11-digit epoch number as ambiguous rather than guessing seconds vs milliseconds", async () => {
    const file = writeRawCsv("ambiguous-epoch", "timestamp,open,high,low,close,volume\n12345678901,100,101,99,100,10");
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(0);
  });

  it("accepts a 13-digit epoch-ms and a 10-digit epoch-seconds timestamp unambiguously", async () => {
    const ms = Date.UTC(2015, 2, 1, 5); // disjoint hour, avoids colliding with other blocks
    const file = writeRawCsv("epoch-variants", `timestamp,open,high,low,close,volume\n${ms},100,101,99,100,10\n${Math.floor(ms / 1000) + 3600},101,102,100,101,10`);
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.invalid).toBe(0);
    expect(stats.inserted).toBe(2);
    await cleanupRange("BTC", "H1", SOURCE, ms, ms + 3_600_000);
  });

  it("rejects a 14-digit or 15-digit numeric timestamp as ambiguous — never guessed as a truncated/extended microsecond value", async () => {
    const file = writeRawCsv("bad-digit-lengths", "timestamp,open,high,low,close,volume\n17550432000000,100,101,99,100,10\n175504320000000,101,102,100,101,10");
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.invalid).toBe(2);
    expect(stats.inserted).toBe(0);
  });

  it("rejects a 17-digit numeric timestamp as ambiguous (one digit too many for microseconds)", async () => {
    const file = writeRawCsv("bad-17-digit", "timestamp,open,high,low,close,volume\n17550432000000000,100,101,99,100,10");
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(0);
  });

  describe("epoch de 16 dígitos (microsegundos)", () => {
    const hourMs = Date.UTC(2015, 3, 1, 3); // disjoint hour from every other block in this file
    afterAll(() => cleanupRange("BTC", "H1", SOURCE, hourMs, hourMs + 3_600_000));

    it("converts a valid 16-digit microsecond epoch to the exact correct Date, losslessly", async () => {
      const micros = BigInt(hourMs) * BigInt(1000); // exact, no fractional microseconds — a real exchange export wouldn't have any either
      expect(micros.toString()).toHaveLength(16);
      const file = writeRawCsv("valid-micros", `timestamp,open,high,low,close,volume\n${micros.toString()},100,101,99,100.5,10`);

      const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
      expect(stats.invalid).toBe(0);
      expect(stats.inserted).toBe(1);
      expect(stats.firstTimestamp?.getTime()).toBe(hourMs); // exact round-trip, not off by any rounding

      const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
      const row = await prisma.marketData.findFirstOrThrow({ where: { assetId: asset.id, timeframe: "H1", source: SOURCE, timestamp: new Date(hourMs) } });
      expect(row.timestamp.getTime()).toBe(hourMs);
    });

    it("truncates a microsecond timestamp with a non-zero sub-millisecond remainder down to the millisecond, without throwing", async () => {
      const micros = BigInt(hourMs) * BigInt(1000) + BigInt(999); // .999 of a microsecond-fraction beyond the exact ms boundary
      const file = writeRawCsv("micros-remainder", `timestamp,open,high,low,close,volume\n${micros.toString()},100,101,99,100.5,10`);
      const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
      expect(stats.invalid).toBe(0);
      expect(stats.firstTimestamp?.getTime()).toBe(hourMs); // sub-ms remainder is truncated, never rounded up into the next candle
    });

    it("handles a 16-digit value large enough to exceed Number.MAX_SAFE_INTEGER's safe integer arithmetic if done via plain Number()", async () => {
      // A far-future date whose microsecond value is comfortably past
      // Number.MAX_SAFE_INTEGER (9_007_199_254_740_991) — proves the
      // BigInt path, not floating-point Number() math, is what's used.
      const farMs = Date.UTC(2260, 0, 1); // ~9,246,960,000,000 ms -> 16-digit micros, near/above MAX_SAFE_INTEGER territory
      const micros = BigInt(farMs) * BigInt(1000);
      const file = writeRawCsv("micros-large", `timestamp,open,high,low,close,volume\n${micros.toString()},100,101,99,100.5,10`);
      const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
      expect(stats.invalid).toBe(0);
      expect(stats.firstTimestamp?.getTime()).toBe(farMs);
      await cleanupRange("BTC", "H1", SOURCE, farMs, farMs);
    });
  });
});

// Format B: Binance's own raw klines row shape (12 columns, no header).
// closeTime/quoteVolume/numTrades/takerBuy*/ignore (columns 6-11) are
// filled with plausible-looking but arbitrary values on purpose, to prove
// the importer truly never reads them — not just that it happens to work
// when they're zero.
function rawKlineLine(openMs: number | bigint, open: number, high: number, low: number, close: number, volume: number): string {
  const closeMs = typeof openMs === "bigint" ? openMs + BigInt(3_599_999) : openMs + 3_599_999;
  return [openMs, open, high, low, close, volume, closeMs, "12345.6789", "42", "1.2345", "6789.01", "0"].join(",");
}

describe("Fase 9.1.8 — Formato B: klines crudas de Binance (12 columnas, sin cabecera)", () => {
  const startMs = Date.UTC(2009, 0, 1);
  const source = "binance_csv";

  afterAll(() => cleanupRange("BTC", "H1", source, startMs, startMs + 3 * 3_600_000));

  it("test #1 — acepta un archivo de klines crudas de Binance de 12 columnas sin cabecera", async () => {
    const file = writeRawCsv("raw-basic", [rawKlineLine(startMs, 100, 101, 99, 100.5, 10), rawKlineLine(startMs + 3_600_000, 100.5, 102, 100, 101, 12)].join("\n"));
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.status).toBe("DONE");
    expect(stats.rowsRead).toBe(2);
    expect(stats.inserted).toBe(2);
  });

  it("test #2 — extrae correctamente openTime (columna 0) y OHLCV (columnas 1-5)", async () => {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const row = await prisma.marketData.findFirstOrThrow({ where: { assetId: asset.id, timeframe: "H1", source, timestamp: new Date(startMs) } });
    expect(row.open).toBe(100);
    expect(row.high).toBe(101);
    expect(row.low).toBe(99);
    expect(row.close).toBe(100.5);
    expect(row.volume).toBe(10);
  });

  it("test #3 — ignora completamente closeTime y la metadata de Binance (columnas 6-11), sea cual sea su valor", async () => {
    const t = startMs + 2 * 3_600_000;
    // closeTime deliberately wrong/nonsensical, and garbage-ish metadata —
    // must have zero effect on the parsed OHLCV bar.
    const line = [t, 200, 201, 199, 200.5, 20, 999999999999, "not-a-number", "-1", "garbage", "", "1"].join(",");
    const file = writeRawCsv("raw-ignore-metadata", line);
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.invalid).toBe(0);
    expect(stats.inserted).toBe(1);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const row = await prisma.marketData.findFirstOrThrow({ where: { assetId: asset.id, timeframe: "H1", source, timestamp: new Date(t) } });
    expect(row.open).toBe(200);
    expect(row.close).toBe(200.5);
  });

  it("test #4 — acepta epoch microseconds de 16 dígitos como columna 0 en Formato B", async () => {
    const microsMs = Date.UTC(2009, 1, 1, 5);
    const micros = BigInt(microsMs) * BigInt(1000);
    const file = writeRawCsv("raw-micros", rawKlineLine(micros, 300, 301, 299, 300.5, 30));
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.invalid).toBe(0);
    expect(stats.firstTimestamp?.getTime()).toBe(microsMs);
    await cleanupRange("BTC", "H1", source, microsMs, microsMs);
  });

  it("test #5 — rechaza una fila con menos de 12 columnas (formato ya establecido por una primera fila válida)", async () => {
    const t = Date.UTC(2009, 1, 2);
    const goodLine = rawKlineLine(t, 100, 101, 99, 100.5, 10); // establishes Format B (12 cols) for the whole file
    const shortLine = `${t + 3_600_000},100,101,99,100.5,10,${t + 7_199_999},1,2,3`; // only 10 columns
    const file = writeRawCsv("raw-too-few-cols", [goodLine, shortLine].join("\n"));
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(1); // the good line is still imported; only the malformed row is rejected
    await cleanupRange("BTC", "H1", source, t, t);
  });

  it("test #6 — rechaza una fila con más de 12 columnas (formato ya establecido por una primera fila válida)", async () => {
    const t = Date.UTC(2009, 1, 3);
    const goodLine = rawKlineLine(t, 100, 101, 99, 100.5, 10);
    const longLine = `${t + 3_600_000},100,101,99,100.5,10,${t + 7_199_999},1,2,3,4,5,6`; // 13 columns
    const file = writeRawCsv("raw-too-many-cols", [goodLine, longLine].join("\n"));
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(1);
    await cleanupRange("BTC", "H1", source, t, t);
  });

  it("test #7 — rechaza un timestamp inválido/ambiguo en la columna 0 de Formato B", async () => {
    const file = writeRawCsv("raw-bad-ts", rawKlineLine(12345678901234, 100, 101, 99, 100.5, 10)); // 14 digits — ambiguous, never guessed
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(0);
  });

  it("test #8 — mantiene la validación OHLCV existente (high < low se rechaza igual que en Formato A)", async () => {
    const t = Date.UTC(2009, 1, 4);
    const file = writeRawCsv("raw-bad-ohlc", rawKlineLine(t, 100, 50, 60, 55, 10)); // high < low
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.invalid).toBe(1);
    expect(stats.inserted).toBe(0);
  });

  it("test #9 — detecta duplicados dentro de un mismo archivo Formato B", async () => {
    const t = Date.UTC(2009, 1, 5);
    const line = rawKlineLine(t, 400, 401, 399, 400.5, 40);
    const file = writeRawCsv("raw-dup", [line, line].join("\n")); // exact duplicate row
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.inserted).toBe(1); // only one of the two identical rows is written
    await cleanupRange("BTC", "H1", source, t, t);
  });

  it("tests #10/#11/#12 — idempotencia, isDemo=false y source=binance_csv", async () => {
    const t = Date.UTC(2009, 1, 6);
    const file1 = writeRawCsv("raw-idem-1", rawKlineLine(t, 500, 501, 499, 500.5, 50));
    const first = await importHistoricalMarketDataFromFile({ filePath: file1, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(first.inserted).toBe(1);
    expect(first.duplicates).toBe(0);

    const file2 = writeRawCsv("raw-idem-2", rawKlineLine(t, 500, 501, 499, 500.5, 50));
    const second = await importHistoricalMarketDataFromFile({ filePath: file2, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const row = await prisma.marketData.findFirstOrThrow({ where: { assetId: asset.id, timeframe: "H1", source, timestamp: new Date(t) } });
    expect(row.isDemo).toBe(false);
    expect(row.source).toBe("binance_csv");
    const rowCount = await prisma.marketData.count({ where: { assetId: asset.id, timeframe: "H1", source, timestamp: new Date(t) } });
    expect(rowCount).toBe(1); // no duplicate row created by the second run
    await cleanupRange("BTC", "H1", source, t, t);
  });

  it("test #13 — el Formato A (6 columnas con cabecera) sigue funcionando sin cambios, sin confundirse con Formato B", async () => {
    const t = Date.UTC(2009, 1, 7);
    const file = writeCsv("format-a-still-works", [[new Date(t).toISOString(), "600", "601", "599", "600.5", "60"]]);
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });
    expect(stats.status).toBe("DONE");
    expect(stats.inserted).toBe(1);
    await cleanupRange("BTC", "H1", source, t, t);
  });
});

describe("Fase 9.1 tests #5/#6/#7 — orden, duplicados y huecos", () => {
  const startMs = Date.UTC(2014, 0, 1);
  // Rows deliberately written OUT OF ORDER and with a duplicate timestamp,
  // and a deliberate 2-candle gap (indices 0,1,2,[gap 3,4],5).
  afterAll(() => cleanupRange("ETH", "H1", SOURCE, startMs, startMs + 5 * 3_600_000));

  it("sorts unordered rows, drops the duplicate, and leaves the real gap detectable via coverage.ts", async () => {
    const t = (i: number) => new Date(startMs + i * 3_600_000).toISOString();
    const file = writeCsv("order-dup-gap", [
      [t(2), "102", "103", "101", "102.5", "10"], // out of order on purpose
      [t(0), "100", "101", "99", "100.5", "10"],
      [t(1), "100.5", "102", "100", "101", "10"],
      [t(1), "100.5", "102", "100", "101", "10"], // exact duplicate of the row above
      [t(5), "105", "106", "104", "105.5", "10"], // gap: indices 3,4 missing
    ]);

    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "ETHUSDT", timeframe: "H1", source: SOURCE });
    expect(stats.inserted).toBe(4); // t0,t1,t2,t5 — the duplicate t1 row is dropped, never double-written
    expect(stats.invalid).toBeGreaterThanOrEqual(1); // the duplicate row itself

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "ETH" } });
    const rows = await prisma.marketData.findMany({ where: { assetId: asset.id, timeframe: "H1", source: SOURCE }, orderBy: { timestamp: "asc" } });
    expect(rows.map((r) => r.timestamp.getTime())).toEqual([startMs, startMs + 3_600_000, startMs + 2 * 3_600_000, startMs + 5 * 3_600_000]); // strictly ascending, exactly one row per timestamp

    const coverage = await computeMarketDataCoverage("ETH", "H1", SOURCE);
    expect(coverage.rowCount).toBe(4);
    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps[0].missingCandles).toBe(2);
  });
});

describe("Fase 9.1 test #8 — idempotencia", () => {
  const startMs = Date.UTC(2013, 0, 1);
  afterAll(() => cleanupRange("BTC", "H1", "binance_csv_idem", startMs, startMs + 2 * 3_600_000));

  it("running the same CSV twice never duplicates rows and reports duplicates on the second run", async () => {
    const rows: string[][] = [
      [new Date(startMs).toISOString(), "100", "101", "99", "100.5", "10"],
      [new Date(startMs + 3_600_000).toISOString(), "101", "102", "100", "101.5", "10"],
      [new Date(startMs + 2 * 3_600_000).toISOString(), "102", "103", "101", "102.5", "10"],
    ];
    const file1 = writeCsv("idem-1", rows);
    const first = await importHistoricalMarketDataFromFile({ filePath: file1, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: "binance_csv_idem" });
    expect(first.inserted).toBe(3);
    expect(first.duplicates).toBe(0);

    const file2 = writeCsv("idem-2", rows);
    const second = await importHistoricalMarketDataFromFile({ filePath: file2, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: "binance_csv_idem" });
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(3);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const rowCount = await prisma.marketData.count({ where: { assetId: asset.id, timeframe: "H1", source: "binance_csv_idem" } });
    expect(rowCount).toBe(3); // no duplicate rows created
  });
});

describe("Fase 9.1 tests #9/#10/#11 — mapeo BTCUSDT->BTC, isDemo=false, source correcto", () => {
  const startMs = Date.UTC(2012, 0, 1);
  afterAll(() => cleanupRange("BTC", "H1", SOURCE, startMs, startMs + 3_600_000));

  it("BTCUSDT maps to the internal Asset symbol BTC (never a bare/ambiguous symbol)", async () => {
    const file = writeCsv("mapping", [[new Date(startMs).toISOString(), "100", "101", "99", "100.5", "10"]]);
    await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: SOURCE });
    const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const row = await prisma.marketData.findFirstOrThrow({ where: { assetId: asset.id, timeframe: "H1", source: SOURCE } });
    expect(row.isDemo).toBe(false);
    expect(row.source).toBe(SOURCE);
    expect(row.quality).toBe(100);
  });

  it("rejects source='binance' outright — that label is reserved for the live API importer", async () => {
    const file = writeCsv("reserved-source", [[new Date(startMs + 3_600_000).toISOString(), "100", "101", "99", "100.5", "10"]]);
    await expect(importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: "binance" })).rejects.toThrow(/reservado/i);
  });

  it("rejects an empty/missing source rather than defaulting to anything", async () => {
    const file = writeCsv("empty-source", [[new Date(startMs).toISOString(), "100", "101", "99", "100.5", "10"]]);
    await expect(importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source: "" })).rejects.toThrow(/obligatorio/i);
  });

  it("throws for an unmapped exchange symbol rather than guessing an internal one", async () => {
    const file = writeCsv("unmapped", [[new Date(startMs).toISOString(), "100", "101", "99", "100.5", "10"]]);
    await expect(importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "DOGEUSDT", timeframe: "H1", source: SOURCE })).rejects.toThrow(/DOGEUSDT/);
  });
});

describe("Fase 9.1 tests #12/#13 — aislamiento REAL/SYNTHETIC y anti-look-ahead sobre datos de CSV", () => {
  const startMs = Date.UTC(2011, 0, 1);
  const count = 10;
  const stepMs = 3_600_000;
  const endMs = startMs + (count - 1) * stepMs;
  const source = "binance_csv_isolation";

  afterAll(() => cleanupRange("BTC", "H1", source, startMs, endMs));

  it("CSV-imported rows surface through HISTORICAL_REAL, never mislabeled as SYNTHETIC", async () => {
    const rows: string[][] = Array.from({ length: count }, (_, i) => [new Date(startMs + i * stepMs).toISOString(), String(100 + i), String(101 + i), String(99 + i), String(100.5 + i), "10"]);
    const file = writeCsv("isolation", rows);
    await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "BTCUSDT", timeframe: "H1", source });

    const provider = new DbBackedHistoricalMarketDataProvider();
    const { bars, realSources } = await provider.getHistoricalBars("BTC", "H1", new Date(startMs), new Date(endMs));
    // The generic DB-backed provider filters by isDemo:false only (not by
    // a specific source string) — CSV rows are just as REAL as API rows.
    expect(bars).toHaveLength(count);
    expect(realSources).toEqual([source]); // the CSV import's own explicit source label, never "binance"
  });

  it("barsAsOf(csvImportedBars, T) never returns a bar with timestamp greater than T", async () => {
    const result = await getHistoricalBars("BTC", "H1", new Date(startMs), new Date(endMs), "HISTORICAL_REAL");
    expect(result.available).toBe(true);
    expect(result.source).toBe("binance"); // the replay-facing source label is always "binance" for any real row, API or CSV

    const checkpoint = startMs + 4 * stepMs;
    const visible = barsAsOf(result.bars, checkpoint);
    for (const bar of visible) {
      expect(bar.timestamp.getTime()).toBeLessThanOrEqual(checkpoint);
    }
    expect(visible).toHaveLength(5);
  });
});

describe("Fase 9.1 test #14 (prueba end-to-end) — CSV -> importer -> MarketData -> HISTORICAL_REAL -> Replay -> métricas", () => {
  // A clearly test-only fixture (explicit source label, disjoint fixture
  // year, deleted below) — never used or left behind as production
  // historical data, per the explicit instruction not to leave it in dev.db.
  const startMs = Date.UTC(2010, 0, 1);
  const count = 60;
  const stepMs = 3_600_000;
  const endMs = startMs + (count - 1) * stepMs;
  const source = "binance_csv_replay_e2e_fixture";
  const createdRunIds: string[] = [];

  afterAll(async () => {
    await prisma.replayResult.deleteMany({ where: { replayRunId: { in: createdRunIds } } });
    await prisma.replayRun.deleteMany({ where: { id: { in: createdRunIds } } });
    await cleanupRange("ETH", "H1", source, startMs, endMs);
  });

  it("a trending CSV fixture flows CSV -> importer -> MarketData -> HISTORICAL_REAL -> HistoricalReplayEngine -> persisted metrics", async () => {
    const rows: string[][] = Array.from({ length: count }, (_, i) => {
      const close = 1000 + i * 2;
      return [new Date(startMs + i * stepMs).toISOString(), String(close - 1), String(close + 2), String(close - 2), String(close), "50"];
    });
    const file = writeCsv("replay-e2e-fixture", rows);
    const stats = await importHistoricalMarketDataFromFile({ filePath: file, exchangeSymbol: "ETHUSDT", timeframe: "H1", source });
    expect(stats.status).toBe("DONE");
    expect(stats.inserted).toBe(count);

    // Sanity check the DB-backed provider before handing this to the
    // (unmodified) HistoricalReplayEngine.
    const preCheck = await getHistoricalBars("ETH", "H1", new Date(startMs), new Date(endMs), "HISTORICAL_REAL");
    expect(preCheck.available).toBe(true);
    expect(preCheck.source).toBe("binance");
    expect(preCheck.bars).toHaveLength(count);

    const config: ReplayConfig = {
      assetSymbols: ["ETH"],
      timeframe: "H1",
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      strategyId: "trend-following",
      aiMode: "DETERMINISTIC_AI",
      dataSource: "HISTORICAL_REAL",
      initialCapital: 10000,
      riskLevel: 6,
    };

    const runId = await executeReplay({ config });
    createdRunIds.push(runId);

    const run = await prisma.replayRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
    expect(run.status).toBe("DONE"); // never FAILED — real data was actually available for this range
    expect(run.dataSource).toBe("HISTORICAL_REAL");
    expect(run.results).toHaveLength(1);
    expect(run.results[0].metrics).not.toBeNull(); // real metrics were computed, not skipped
  });
});
