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
    });
    expect(manifest).toEqual({
      id: "ds1",
      symbol: "BTC",
      timeframe: "H1",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T05:00:00.000Z",
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
