import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { validateCandleBatch } from "@/lib/marketData/candleValidation";
import { computeMarketDataCoverage } from "@/lib/marketData/coverage";
import { timeframeMs } from "@/lib/marketData/binanceClient";
import type { TimeframeCode, OHLCVBar } from "@/lib/providers/types";

/**
 * Fase 14 — Research Dataset Versioning. A `ResearchDataset` row is a
 * named, reproducible SNAPSHOT of a (symbol, timeframe, source) slice of
 * `MarketData` that ALREADY exists — this module never fetches, generates,
 * or interpolates a single candle. Registering one re-validates the
 * underlying rows fresh (spec section 6) and computes a deterministic hash
 * over them (spec section 5), so a `ReplayRun`/`StrategyBenchmarkRun` can
 * point at this row's id+hash and be reconstructed exactly later, even if
 * more data is imported afterward under the same symbol/timeframe/source.
 */

export interface DatasetRegistrationRequest {
  symbol: string; // internal Asset.symbol, e.g. "BTC"
  timeframe: TimeframeCode;
  startDate: Date;
  endDate: Date;
  source: string; // the real MarketData.source to scope to, e.g. "binance_csv" — never "binance" (reserved for the live API path, same rule offlineImporter.ts already enforces)
}

export interface ResearchDatasetView {
  id: string;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  rowCount: number;
  source: string;
  isDemo: boolean;
  coveragePct: number;
  gapCount: number;
  duplicateCount: number;
  quality: number;
  datasetHash: string;
  createdAt: Date;
  /** Fase 16 — descriptive-only (spec section 10): never used to select/filter a dataset or strategy. Null for any dataset registered before this field existed — never backfilled retroactively (spec section 15/13: existing datasets are never modified). */
  minPrice: number | null;
  maxPrice: number | null;
  minVolume: number | null;
  maxVolume: number | null;
}

export class DatasetValidationError extends Error {}

/**
 * Spec section 5 — the exact, documented algorithm: for each row, in
 * ascending chronological order, build the line
 * `${isoTimestamp}|${open}|${high}|${low}|${close}|${volume}` (numbers
 * formatted via their own `.toString()` — never rounded, never locale-
 * formatted, so the SAME stored float always produces the SAME line), join
 * every row's line with `\n`, then SHA-256 the result and take the hex
 * digest. The SAME dataset (byte-identical rows, same order) always
 * produces the SAME hash; changing even one value, adding, removing, or
 * reordering a row changes it.
 */
export function computeDatasetHash(bars: OHLCVBar[]): string {
  const lines = bars.map((b) => `${b.timestamp.toISOString()}|${b.open}|${b.high}|${b.low}|${b.close}|${b.volume}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export interface CandidateRow {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quality: number;
}

/**
 * Spec section 6 — every check runs fresh against the candidate rows,
 * never assumed true just because the rows already sit in `MarketData`:
 * ascending timestamps, no duplicates, OHLC/volume validity (reusing the
 * SAME `validateCandleBatch` the importer itself runs — Fase 9), aligned
 * H1 intervals (a delta that is neither exactly one step nor a whole
 * number of missing steps is flagged, never silently treated as a gap),
 * and no row past the requested `endDate`. A genuine gap (a whole number
 * of missing steps between two otherwise-valid rows) is NOT a validation
 * failure — spec: "si existen gaps, registrarlos" — it only fails
 * registration when the DATA ITSELF is malformed or inconsistent.
 */
export function validateCandidateRows(rows: CandidateRow[], timeframe: TimeframeCode, requestedEnd: Date): void {
  if (rows.length === 0) {
    throw new DatasetValidationError("No hay velas para el rango/fuente solicitados — no se registra un dataset vacío.");
  }

  const bars: OHLCVBar[] = rows.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const validation = validateCandleBatch(bars);
  if (validation.invalid.length > 0) {
    throw new DatasetValidationError(`${validation.invalid.length} vela(s) inválida(s) (OHLC/volumen) encontradas en MarketData — no se registra el dataset. Primera razón: ${validation.invalid[0].reasons.join("; ")}`);
  }
  if (validation.duplicateTimestamps > 0) {
    throw new DatasetValidationError(`${validation.duplicateTimestamps} timestamp(s) duplicado(s) encontrados — no se registra el dataset.`);
  }
  if (validation.chronologyViolations > 0) {
    throw new DatasetValidationError(`Los timestamps no están en orden ascendente estricto — no se registra el dataset.`);
  }

  const stepMs = timeframeMs(timeframe);
  for (let i = 1; i < rows.length; i++) {
    const deltaMs = rows[i].timestamp.getTime() - rows[i - 1].timestamp.getTime();
    if (deltaMs % stepMs !== 0) {
      throw new DatasetValidationError(`Intervalo no alineado a ${timeframe} entre ${rows[i - 1].timestamp.toISOString()} y ${rows[i].timestamp.toISOString()} — no se registra el dataset.`);
    }
  }

  const last = rows[rows.length - 1].timestamp;
  if (last.getTime() > requestedEnd.getTime()) {
    throw new DatasetValidationError(`Hay una vela (${last.toISOString()}) posterior al end solicitado (${requestedEnd.toISOString()}) — no se registra el dataset.`);
  }
}

/**
 * Registers (or returns the existing) `ResearchDataset` for one
 * (symbol, timeframe, startDate, endDate, source) range — idempotent by
 * design (spec section 8/9: "la importación debe seguir siendo
 * idempotente"), matching the `@@unique` constraint on the model: calling
 * this twice with the identical request returns the SAME row rather than
 * creating a duplicate, and (since the underlying `MarketData` rows for an
 * already-registered range never change) recomputing everything on the
 * second call always reproduces the identical hash — this function itself
 * never mutates `MarketData`.
 */
export async function registerResearchDataset(request: DatasetRegistrationRequest): Promise<ResearchDatasetView> {
  const existing = await prisma.researchDataset.findUnique({
    where: { symbol_timeframe_startDate_endDate_source: { symbol: request.symbol, timeframe: request.timeframe, startDate: request.startDate, endDate: request.endDate, source: request.source } },
  });
  if (existing) return existing;

  const asset = await prisma.asset.findUnique({ where: { symbol: request.symbol } });
  if (!asset) throw new DatasetValidationError(`No existe ningún Asset con symbol "${request.symbol}".`);

  const rows = await prisma.marketData.findMany({
    where: { assetId: asset.id, timeframe: request.timeframe, source: request.source, isDemo: false, timestamp: { gte: request.startDate, lte: request.endDate } },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true, quality: true },
  });

  validateCandidateRows(rows, request.timeframe, request.endDate);

  const bars: OHLCVBar[] = rows.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const datasetHash = computeDatasetHash(bars);
  const duplicateCount = 0; // guaranteed by validateCandidateRows above (any duplicate would have thrown) and by MarketData's own @@unique([assetId, timeframe, timestamp, source])
  const quality = Math.round(rows.reduce((sum, r) => sum + r.quality, 0) / rows.length);

  const coverage = await computeMarketDataCoverage(request.symbol, request.timeframe, request.source, { start: request.startDate, end: request.endDate });
  const gapCount = coverage.gaps.length;
  const coveragePct = coverage.coveragePct ?? 0;

  // Fase 16 — quality-report extras (spec section 10), computed from the SAME
  // `rows` already fetched above — no second query, no second copy of the series.
  const minPrice = Math.min(...rows.map((r) => r.low));
  const maxPrice = Math.max(...rows.map((r) => r.high));
  const minVolume = Math.min(...rows.map((r) => r.volume));
  const maxVolume = Math.max(...rows.map((r) => r.volume));

  return prisma.researchDataset.create({
    data: {
      symbol: request.symbol,
      timeframe: request.timeframe,
      startDate: request.startDate,
      endDate: request.endDate,
      rowCount: rows.length,
      source: request.source,
      isDemo: false,
      coveragePct,
      gapCount,
      duplicateCount,
      quality,
      datasetHash,
      minPrice,
      maxPrice,
      minVolume,
      maxVolume,
    },
  });
}

export interface DatasetManifest {
  id: string;
  symbol: string;
  timeframe: string;
  start: string;
  end: string;
  rowCount: number;
  source: string;
  isDemo: boolean;
  coveragePct: number;
  gapCount: number;
  duplicateCount: number;
  quality: number;
  datasetHash: string;
  createdAt: string;
  minPrice: number | null;
  maxPrice: number | null;
  minVolume: number | null;
  maxVolume: number | null;
}

/** Spec section 7 — the manifest is just this row's own identity, in a stable, self-describing shape (never re-derived from MarketData at read time — the ResearchDataset row IS the frozen snapshot). */
export function buildDatasetManifest(dataset: ResearchDatasetView): DatasetManifest {
  return {
    id: dataset.id,
    symbol: dataset.symbol,
    timeframe: dataset.timeframe,
    start: dataset.startDate.toISOString(),
    end: dataset.endDate.toISOString(),
    rowCount: dataset.rowCount,
    source: dataset.source,
    isDemo: dataset.isDemo,
    coveragePct: dataset.coveragePct,
    gapCount: dataset.gapCount,
    duplicateCount: dataset.duplicateCount,
    quality: dataset.quality,
    datasetHash: dataset.datasetHash,
    createdAt: dataset.createdAt.toISOString(),
    minPrice: dataset.minPrice,
    maxPrice: dataset.maxPrice,
    minVolume: dataset.minVolume,
    maxVolume: dataset.maxVolume,
  };
}

export interface DatasetProvenanceEntry {
  importLogId: string;
  source: string;
  rangeStart: string;
  rangeEnd: string;
  rowsInserted: number;
  rowsUpdated: number;
  status: string;
  importedAt: string;
}

/**
 * Fase 16 spec section 11 — "si un dataset se construye a partir de varios
 * archivos mensuales, documentar todos los componentes." Computed at READ
 * time (never stored on the `ResearchDataset` row itself — imports for the
 * same symbol/timeframe/source can keep happening after a dataset is
 * registered, so a frozen snapshot list would go stale): every
 * `MarketDataImportLog` row for this dataset's (symbol→assetId, timeframe,
 * source) whose OWN actual content range (see the Fase 16 fix in
 * `offlineImporter.ts`: `rangeStart`/`rangeEnd` now reflect the real
 * imported range, not a placeholder) overlaps the dataset's range.
 * Import-log rows from BEFORE that fix (placeholder epoch-0/"now" bounds)
 * may still appear or be missed here — an honest limitation of historical
 * log data this function cannot retroactively repair, documented in the
 * Fase 16 report rather than silently patched.
 */
export async function buildDatasetProvenance(dataset: ResearchDatasetView): Promise<DatasetProvenanceEntry[]> {
  const asset = await prisma.asset.findUnique({ where: { symbol: dataset.symbol } });
  if (!asset) return [];

  const logs = await prisma.marketDataImportLog.findMany({
    where: {
      assetId: asset.id,
      timeframe: dataset.timeframe,
      source: dataset.source,
      rangeStart: { lte: dataset.endDate },
      rangeEnd: { gte: dataset.startDate },
    },
    orderBy: { importedAt: "asc" },
  });

  return logs.map((log) => ({
    importLogId: log.id,
    source: log.source,
    rangeStart: log.rangeStart.toISOString(),
    rangeEnd: log.rangeEnd.toISOString(),
    rowsInserted: log.rowsInserted,
    rowsUpdated: log.rowsUpdated,
    status: log.status,
    importedAt: log.importedAt.toISOString(),
  }));
}
