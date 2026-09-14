import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { computeDatasetHash, buildDatasetManifest, registerResearchDataset, validateCandidateRows, DatasetValidationError, type CandidateRow } from "../researchDataset";
import type { OHLCVBar } from "@/lib/providers/types";

function bar(overrides: Partial<OHLCVBar> = {}): OHLCVBar {
  return { timestamp: new Date("2026-01-01T00:00:00.000Z"), open: 100, high: 101, low: 99, close: 100.5, volume: 10, ...overrides };
}

function candidateRow(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return { timestamp: new Date("2026-01-01T00:00:00.000Z"), open: 100, high: 101, low: 99, close: 100.5, volume: 10, quality: 100, ...overrides };
}

describe("computeDatasetHash — deterministic, sensitive to any change", () => {
  it("produces the same hash for identical bars", () => {
    const bars = [bar(), bar({ timestamp: new Date("2026-01-01T01:00:00.000Z") })];
    expect(computeDatasetHash(bars)).toBe(computeDatasetHash(bars));
  });

  it("changes when a single value changes", () => {
    const a = [bar()];
    const b = [bar({ close: 100.6 })];
    expect(computeDatasetHash(a)).not.toBe(computeDatasetHash(b));
  });

  it("changes when row order changes", () => {
    const b1 = bar({ timestamp: new Date("2026-01-01T00:00:00.000Z") });
    const b2 = bar({ timestamp: new Date("2026-01-01T01:00:00.000Z"), close: 105 });
    expect(computeDatasetHash([b1, b2])).not.toBe(computeDatasetHash([b2, b1]));
  });

  it("changes when a row is added or removed", () => {
    const base = [bar()];
    const extended = [bar(), bar({ timestamp: new Date("2026-01-01T01:00:00.000Z") })];
    expect(computeDatasetHash(base)).not.toBe(computeDatasetHash(extended));
  });
});

describe("validateCandidateRows — pre-registration gates (spec section 6)", () => {
  const end = new Date("2026-01-01T10:00:00.000Z");

  it("accepts ascending, valid, H1-aligned rows with no future timestamp past end", () => {
    const rows = [candidateRow({ timestamp: new Date("2026-01-01T00:00:00.000Z") }), candidateRow({ timestamp: new Date("2026-01-01T01:00:00.000Z") })];
    expect(() => validateCandidateRows(rows, "H1", end)).not.toThrow();
  });

  it("accepts a real gap between two valid rows (spec: gaps are registered, never a failure)", () => {
    const rows = [candidateRow({ timestamp: new Date("2026-01-01T00:00:00.000Z") }), candidateRow({ timestamp: new Date("2026-01-01T05:00:00.000Z") })];
    expect(() => validateCandidateRows(rows, "H1", end)).not.toThrow();
  });

  it("rejects an empty candidate set rather than registering an empty dataset", () => {
    expect(() => validateCandidateRows([], "H1", end)).toThrow(DatasetValidationError);
  });

  it("rejects invalid OHLC (high < low)", () => {
    const rows = [candidateRow({ high: 90, low: 99 })];
    expect(() => validateCandidateRows(rows, "H1", end)).toThrow(DatasetValidationError);
  });

  it("rejects duplicate timestamps", () => {
    const t = new Date("2026-01-01T00:00:00.000Z");
    const rows = [candidateRow({ timestamp: t }), candidateRow({ timestamp: t })];
    expect(() => validateCandidateRows(rows, "H1", end)).toThrow(DatasetValidationError);
  });

  it("rejects out-of-order (non-ascending) timestamps", () => {
    const rows = [candidateRow({ timestamp: new Date("2026-01-01T02:00:00.000Z") }), candidateRow({ timestamp: new Date("2026-01-01T01:00:00.000Z") })];
    expect(() => validateCandidateRows(rows, "H1", end)).toThrow(DatasetValidationError);
  });

  it("rejects an interval not aligned to the timeframe step", () => {
    const rows = [candidateRow({ timestamp: new Date("2026-01-01T00:00:00.000Z") }), candidateRow({ timestamp: new Date("2026-01-01T00:30:00.000Z") })];
    expect(() => validateCandidateRows(rows, "H1", end)).toThrow(DatasetValidationError);
  });

  it("rejects a row past the requested end date", () => {
    const rows = [candidateRow({ timestamp: new Date("2026-01-01T11:00:00.000Z") })];
    expect(() => validateCandidateRows(rows, "H1", end)).toThrow(DatasetValidationError);
  });
});

describe("registerResearchDataset — idempotent registration over real MarketData rows", () => {
  const startMs = Date.UTC(2022, 0, 1);
  const stepMs = 3_600_000;
  // deliberate single-candle gap between index 4 and 6
  const presentIndices = [0, 1, 2, 3, 4, 6, 7, 8, 9];
  let assetId: string;

  beforeAll(async () => {
    const asset = await prisma.asset.upsert({ where: { symbol: "BTC" }, update: {}, create: { symbol: "BTC", name: "Bitcoin" } });
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
          close: 100.5,
          volume: 10,
          source: "fase14_test_source",
          isDemo: false,
          quality: 90,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.marketData.deleteMany({ where: { assetId, timeframe: "H1", source: "fase14_test_source" } });
    await prisma.researchDataset.deleteMany({ where: { symbol: "BTC", timeframe: "H1", source: "fase14_test_source" } });
  });

  const request = { symbol: "BTC", timeframe: "H1" as const, startDate: new Date(startMs), endDate: new Date(startMs + 9 * stepMs), source: "fase14_test_source" };

  it("registers a dataset with correct rowCount/source/isDemo/quality/gapCount/datasetHash", async () => {
    const ds = await registerResearchDataset(request);
    expect(ds.rowCount).toBe(presentIndices.length);
    expect(ds.source).toBe("fase14_test_source");
    expect(ds.isDemo).toBe(false);
    expect(ds.quality).toBe(90);
    expect(ds.gapCount).toBe(1); // the single missing candle at index 5
    expect(ds.duplicateCount).toBe(0);
    expect(ds.datasetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ds.coveragePct).toBeLessThan(100);
  });

  it("is idempotent — registering the SAME range twice returns the SAME row, never a duplicate", async () => {
    const first = await registerResearchDataset(request);
    const second = await registerResearchDataset(request);
    expect(second.id).toBe(first.id);
    expect(second.datasetHash).toBe(first.datasetHash);

    const count = await prisma.researchDataset.count({ where: { symbol: "BTC", timeframe: "H1", source: "fase14_test_source" } });
    expect(count).toBe(1);
  });

  it("produces the same hash across two independent registration calls (same data -> same hash)", async () => {
    const a = await registerResearchDataset(request);
    await prisma.researchDataset.delete({ where: { id: a.id } });
    const b = await registerResearchDataset(request);
    expect(b.datasetHash).toBe(a.datasetHash);
  });

  it("throws DatasetValidationError for an unknown symbol rather than silently registering nothing", async () => {
    await expect(registerResearchDataset({ ...request, symbol: "NOPE" })).rejects.toThrow(DatasetValidationError);
  });
});

describe("buildDatasetManifest — spec section 7", () => {
  it("mirrors the dataset row's own fields in ISO/manifest shape", () => {
    const now = new Date("2026-01-02T00:00:00.000Z");
    const manifest = buildDatasetManifest({
      id: "ds1",
      symbol: "BTC",
      timeframe: "H1",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-01T05:00:00.000Z"),
      rowCount: 6,
      source: "binance_csv",
      isDemo: false,
      coveragePct: 100,
      gapCount: 0,
      duplicateCount: 0,
      quality: 100,
      datasetHash: "abc123",
      createdAt: now,
      minPrice: 99,
      maxPrice: 105,
      minVolume: 10,
      maxVolume: 50,
    });
    expect(manifest).toEqual({
      id: "ds1",
      symbol: "BTC",
      timeframe: "H1",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T05:00:00.000Z",
      minPrice: 99,
      maxPrice: 105,
      minVolume: 10,
      maxVolume: 50,
      rowCount: 6,
      source: "binance_csv",
      isDemo: false,
      coveragePct: 100,
      gapCount: 0,
      duplicateCount: 0,
      quality: 100,
      datasetHash: "abc123",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
  });
});

describe("registerResearchDataset — símbolo/timeframe diferentes se separan correctamente (spec section 14 item 11)", () => {
  const startMs = Date.UTC(2021, 0, 1);
  const stepMs = 3_600_000;
  const source = "fase16_separation_test";
  const range = { startDate: new Date(startMs), endDate: new Date(startMs + 4 * stepMs) };
  let btcId: string;
  let ethId: string;

  beforeAll(async () => {
    const btc = await prisma.asset.upsert({ where: { symbol: "BTC" }, update: {}, create: { symbol: "BTC", name: "Bitcoin" } });
    const eth = await prisma.asset.upsert({ where: { symbol: "ETH" }, update: {}, create: { symbol: "ETH", name: "Ethereum" } });
    btcId = btc.id;
    ethId = eth.id;

    // Same timestamps, same timeframe, DIFFERENT symbols — deliberately
    // different close prices so a symbol mix-up would be caught by a hash mismatch.
    for (let i = 0; i <= 4; i++) {
      await prisma.marketData.create({ data: { assetId: btcId, timeframe: "H1", timestamp: new Date(startMs + i * stepMs), open: 100, high: 101 + i, low: 99, close: 100 + i, volume: 10, source, isDemo: false, quality: 100 } });
      await prisma.marketData.create({ data: { assetId: ethId, timeframe: "H1", timestamp: new Date(startMs + i * stepMs), open: 200, high: 201 + i, low: 199, close: 200 + i, volume: 20, source, isDemo: false, quality: 100 } });
    }
    // Same symbol (BTC), same range, DIFFERENT timeframe (H4) — coarser step, fewer aligned candles.
    for (let i = 0; i <= 1; i++) {
      await prisma.marketData.create({ data: { assetId: btcId, timeframe: "H4", timestamp: new Date(startMs + i * 4 * stepMs), open: 300, high: 301 + i, low: 299, close: 300 + i, volume: 30, source, isDemo: false, quality: 100 } });
    }
  });

  afterAll(async () => {
    await prisma.marketData.deleteMany({ where: { source, timeframe: { in: ["H1", "H4"] } } });
    await prisma.researchDataset.deleteMany({ where: { source, symbol: { in: ["BTC", "ETH"] } } });
  });

  it("two different symbols at the identical timeframe/range never cross-contaminate rowCount or hash", async () => {
    const btcDs = await registerResearchDataset({ symbol: "BTC", timeframe: "H1", ...range, source });
    const ethDs = await registerResearchDataset({ symbol: "ETH", timeframe: "H1", ...range, source });

    expect(btcDs.symbol).toBe("BTC");
    expect(ethDs.symbol).toBe("ETH");
    expect(btcDs.rowCount).toBe(5);
    expect(ethDs.rowCount).toBe(5); // ETH rows counted independently of BTC's, not merged/doubled
    expect(btcDs.datasetHash).not.toBe(ethDs.datasetHash); // different close prices per symbol -> different hash
  });

  it("the same symbol at two different timeframes over an overlapping range is registered as two distinct datasets", async () => {
    const h1Ds = await registerResearchDataset({ symbol: "BTC", timeframe: "H1", ...range, source });
    const h4Ds = await registerResearchDataset({ symbol: "BTC", timeframe: "H4", startDate: range.startDate, endDate: new Date(startMs + 4 * stepMs), source });

    expect(h1Ds.id).not.toBe(h4Ds.id);
    expect(h1Ds.timeframe).toBe("H1");
    expect(h4Ds.timeframe).toBe("H4");
    expect(h1Ds.rowCount).toBe(5); // the 5 H1 candles, never picking up the H4 rows
    expect(h4Ds.rowCount).toBe(2); // only the 2 H4 candles, never picking up the H1 rows
  });
});

describe("registerResearchDataset — expanding history for an already-registered symbol never touches the existing (narrower) ResearchDataset row (Fase 21 spec Condición 2)", () => {
  // Mirrors the real Fase 21 operation: a NARROW range (the "frozen benchmark")
  // gets registered first; later, MORE history for the SAME symbol/timeframe/
  // source is imported and registered as a SEPARATE, WIDER range. The unique
  // constraint is (symbol, timeframe, startDate, endDate, source) — a
  // different startDate/endDate is, by construction, a DIFFERENT row, never
  // an update to the narrow one. This test proves that in practice, not just
  // by reading the schema.
  const stepMs = 3_600_000;
  const narrowStart = Date.UTC(2026, 2, 1); // "frozen benchmark" start
  const narrowEnd = narrowStart + 4 * stepMs;
  const wideStart = Date.UTC(2026, 0, 1); // earlier history added later
  const wideEnd = narrowEnd;
  const source = "fase21_expansion_test";
  let assetId: string;

  beforeAll(async () => {
    const asset = await prisma.asset.upsert({ where: { symbol: "BTC" }, update: {}, create: { symbol: "BTC", name: "Bitcoin" } });
    assetId = asset.id;
    // Rows spanning the WIDE range from the start — as if the extra history
    // had already been imported before either registration call runs (this
    // test only exercises registerResearchDataset, not the importer itself).
    const totalHours = Math.round((wideEnd - wideStart) / stepMs) + 1;
    for (let i = 0; i < totalHours; i++) {
      const ts = new Date(wideStart + i * stepMs);
      await prisma.marketData.create({ data: { assetId, timeframe: "H1", timestamp: ts, open: 100, high: 101 + i, low: 99, close: 100 + i, volume: 10, source, isDemo: false, quality: 100 } });
    }
  });

  afterAll(async () => {
    await prisma.marketData.deleteMany({ where: { assetId, timeframe: "H1", source } });
    await prisma.researchDataset.deleteMany({ where: { symbol: "BTC", timeframe: "H1", source } });
  });

  it("registering the wide range AFTER the narrow one leaves the narrow row's id/hash/rowCount byte-identical", async () => {
    const narrow = await registerResearchDataset({ symbol: "BTC", timeframe: "H1", startDate: new Date(narrowStart), endDate: new Date(narrowEnd), source });
    const narrowSnapshot = { ...narrow };

    const wide = await registerResearchDataset({ symbol: "BTC", timeframe: "H1", startDate: new Date(wideStart), endDate: new Date(wideEnd), source });

    // Re-read the narrow row fresh from the DB — not just the in-memory value returned earlier.
    const narrowAfter = await prisma.researchDataset.findUnique({ where: { id: narrow.id } });

    expect(narrowAfter).toEqual(narrowSnapshot);
    expect(wide.id).not.toBe(narrow.id);
    expect(wide.rowCount).toBeGreaterThan(narrow.rowCount);
    expect(wide.datasetHash).not.toBe(narrow.datasetHash);

    const count = await prisma.researchDataset.count({ where: { symbol: "BTC", timeframe: "H1", source } });
    expect(count).toBe(2); // both rows coexist — neither was overwritten or merged
  });
});
