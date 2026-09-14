import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";
import { resolveInternalSymbol } from "./symbolMapping";
import { validateCandleBatch } from "./candleValidation";

/**
 * Fase 9.1 — the SECOND way real historical candles reach `MarketData`,
 * alongside `importer.ts` (live Binance API). Both terminate in the exact
 * same table with the exact same shape:
 *
 *   Binance API  -> binanceClient/importer.ts        -> MarketData
 *   CSV/JSON file -> offlineImporter.ts (this file)  -> MarketData
 *
 * `source: "binance"` is RESERVED for rows that actually came through the
 * live API path (importer.ts hardcodes it from `symbolMapping`'s
 * `exchange` field). This module refuses that value outright — a CSV
 * import always ships its own explicit label (e.g. "binance_csv") so a
 * row's `source` always tells the truth about how it got here. A caller
 * cannot make this module claim "REAL" without saying so explicitly:
 * `source` is a required parameter, never defaulted, and `isDemo` is not
 * even an accepted parameter — every row this module writes gets
 * `isDemo: false` unconditionally.
 */

export const CSV_HEADER = ["timestamp", "open", "high", "low", "close", "volume"] as const;

export interface OfflineImportOptions {
  filePath: string;
  exchangeSymbol: string; // e.g. "BTCUSDT" — mapped via symbolMapping, same as the live importer
  timeframe: TimeframeCode;
  /** Required, explicit, never defaulted. Must NOT be "binance" — that label is reserved for the live API path (importer.ts). */
  source: string;
  /** Optional — when given, any candle outside [startDate, endDate] is rejected (never inserted), exactly like importer.ts. */
  startDate?: Date;
  endDate?: Date;
}

export interface OfflineImportStats {
  rowsRead: number; // data rows found in the file, before any parsing/validation
  rowsValid: number; // rows that parsed and passed OHLCV validation
  inserted: number;
  updated: number;
  duplicates: number; // existing rows with identical values already stored
  skipped: number; // valid candles outside [startDate, endDate], never written
  invalid: number; // rows that failed to parse or failed OHLCV validation
  firstTimestamp: Date | null;
  lastTimestamp: Date | null;
  status: "DONE" | "PARTIAL" | "FAILED";
  error: string | null;
  importLogId: string;
}

interface ParsedRow {
  bar: OHLCVBar;
}

interface RowError {
  line: number;
  reason: string;
}

const RESERVED_LIVE_API_SOURCE = "binance";

/**
 * Pure digits only — epoch. 10 digits is seconds, 13 is milliseconds, 16 is
 * microseconds; any other digit length is ambiguous and rejected rather
 * than guessed.
 *
 * The 16-digit (microsecond) case is converted via BigInt rather than
 * `Number()`: a real microsecond timestamp (e.g. `1754006400000000`) can
 * exceed `Number.MAX_SAFE_INTEGER` (~9.007e15, 16 digits) once past the
 * year ~2255 doesn't matter here, but more importantly `Number("...")` on
 * a 16-digit string already risks silently rounding the last 1-2 digits
 * on some inputs — BigInt division truncates exactly, with no float
 * rounding, before converting down to a plain millisecond number (which
 * is always well within the safe integer range).
 */
function parseEpochDigits(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  if (raw.length === 10) return Number(raw) * 1000; // seconds -> ms
  if (raw.length === 13) return Number(raw); // already ms
  if (raw.length === 16) return Number(BigInt(raw) / BigInt(1000)); // microseconds -> ms, exact integer division
  return null; // ambiguous digit length — never guessed
}

const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Returns the epoch-ms timestamp, or a `{ error }` describing exactly why it could not be determined unambiguously. Never guesses. */
function parseTimestampStrict(raw: string): { ms: number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "timestamp vacío" };

  const epochMs = parseEpochDigits(trimmed);
  if (epochMs !== null) return { ms: epochMs };

  if (/^\d+$/.test(trimmed)) {
    return {
      error: `timestamp numérico con ${trimmed.length} dígitos — no se puede determinar de forma inequívoca si es epoch en segundos (10), milisegundos (13) o microsegundos (16); nunca se adivina`,
    };
  }

  if (ISO_8601_PATTERN.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) return { error: `no se pudo interpretar "${trimmed}" como fecha ISO-8601 válida` };
    return { ms };
  }

  return { error: `formato de timestamp no reconocido: "${trimmed}" (se aceptan ISO-8601 o epoch de 10/13/16 dígitos)` };
}

function parseNumberStrict(raw: string, fieldName: string): number | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: `${fieldName} vacío` };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { error: `${fieldName} no es un número válido: "${trimmed}"` };
  return n;
}

interface CsvParseResult {
  rowsRead: number;
  parsed: ParsedRow[];
  errors: RowError[];
}

/** Format B: Binance's own raw klines column layout — see the module doc comment. */
const RAW_KLINE_COLUMN_COUNT = 12;

type CsvFormat = "HEADER_6COL" | "RAW_KLINE_12COL";

/**
 * Looks ONLY at the first line to decide which of the two supported
 * formats the whole file is in — never per-row, so a file can't silently
 * drift between formats line to line. Format A is recognized by its exact
 * literal header; Format B (headerless) is recognized by column count
 * alone, since a raw klines export has no header to check.
 */
function detectCsvFormat(firstLine: string): { format: CsvFormat } | { error: string } {
  const cols = firstLine.split(",");
  const asHeader = cols.map((h) => h.trim().toLowerCase());
  const expectedHeader = CSV_HEADER as readonly string[];
  if (asHeader.length === expectedHeader.length && expectedHeader.every((h, i) => asHeader[i] === h)) {
    return { format: "HEADER_6COL" };
  }
  if (cols.length === RAW_KLINE_COLUMN_COUNT) {
    return { format: "RAW_KLINE_12COL" };
  }
  return {
    error:
      `Formato de CSV no reconocido. Se aceptan dos formatos: ` +
      `(A) cabecera "${expectedHeader.join(",")}", o ` +
      `(B) klines crudas de Binance sin cabecera con exactamente ${RAW_KLINE_COLUMN_COUNT} columnas (openTime,open,high,low,close,volume,closeTime,quoteVolume,numTrades,takerBuyBase,takerBuyQuote,ignore). ` +
      `Primera línea recibida (${cols.length} columnas): "${firstLine}"`,
  };
}

/**
 * Minimal CSV parser supporting exactly two documented formats — no
 * quoting/escaping support in either, since a market-data OHLCV export
 * never needs it, and refusing anything else keeps "can the format be
 * determined unambiguously" a hard yes/no rather than a guess:
 *
 *  - Format A: `timestamp,open,high,low,close,volume`, header required,
 *    columns in this exact order, one candle per line.
 *  - Format B: Binance's own raw klines row shape, NO header line, exactly
 *    12 columns per line (`openTime,open,high,low,close,volume,closeTime,
 *    quoteVolume,numTrades,takerBuyBase,takerBuyQuote,ignore`). Only
 *    column 0 (timestamp) and columns 1-5 (OHLCV) are ever read; columns
 *    6-11 are Binance metadata this importer has no use for and never
 *    even looks at, let alone writes anywhere.
 */
function parseCsv(content: string): CsvParseResult {
  const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("CSV vacío: no se encontró ni siquiera una línea de datos.");
  }

  const detected = detectCsvFormat(lines[0]);
  if ("error" in detected) {
    throw new Error(detected.error);
  }
  const { format } = detected;

  const dataLines = format === "HEADER_6COL" ? lines.slice(1) : lines;
  const expectedCols = format === "HEADER_6COL" ? CSV_HEADER.length : RAW_KLINE_COLUMN_COUNT;
  const lineNumberOffset = format === "HEADER_6COL" ? 2 : 1; // +1 for the header row when there is one

  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const lineNumber = i + lineNumberOffset;
    const cols = dataLines[i].split(",");
    if (cols.length !== expectedCols) {
      errors.push({ line: lineNumber, reason: `se esperaban ${expectedCols} columnas (formato ${format === "HEADER_6COL" ? "A" : "B"}), se encontraron ${cols.length}` });
      continue;
    }
    // Columns 0-5 are timestamp+OHLCV in BOTH formats; Format B's columns
    // 6-11 (closeTime, quoteVolume, numTrades, takerBuy*, ignore) are
    // simply never read — `cols` is not even sliced for them.
    const [tsRaw, openRaw, highRaw, lowRaw, closeRaw, volumeRaw] = cols;

    const ts = parseTimestampStrict(tsRaw);
    if ("error" in ts) {
      errors.push({ line: lineNumber, reason: ts.error });
      continue;
    }

    const open = parseNumberStrict(openRaw, "open");
    const high = parseNumberStrict(highRaw, "high");
    const low = parseNumberStrict(lowRaw, "low");
    const close = parseNumberStrict(closeRaw, "close");
    const volume = parseNumberStrict(volumeRaw, "volume");
    const numericError = [open, high, low, close, volume].find((v): v is { error: string } => typeof v === "object");
    if (numericError) {
      errors.push({ line: lineNumber, reason: numericError.error });
      continue;
    }

    parsed.push({
      bar: {
        timestamp: new Date(ts.ms),
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volume as number,
      },
    });
  }

  return { rowsRead: dataLines.length, parsed, errors };
}

/**
 * Reads a CSV file of REAL historical candles and imports it into
 * `MarketData` through the exact same validation, diff-based upsert, and
 * `MarketDataImportLog` bookkeeping as the live Binance importer — the
 * only difference is where the candles come from. Idempotent: re-running
 * against the same file (or an overlapping one) reports `duplicates` for
 * every already-correctly-stored row rather than creating new ones.
 */
export async function importHistoricalMarketDataFromFile(options: OfflineImportOptions): Promise<OfflineImportStats> {
  if (options.source.trim().toLowerCase() === RESERVED_LIVE_API_SOURCE) {
    throw new Error(`source="${options.source}" está reservado para la ruta de la API en vivo (importer.ts). Usa una etiqueta explícita distinta, p. ej. "binance_csv".`);
  }
  if (options.source.trim() === "") {
    throw new Error("source es obligatorio y no puede estar vacío — nunca se asume que un archivo es REAL sin metadata explícita.");
  }

  const mapping = resolveInternalSymbol(options.exchangeSymbol);
  const source = options.source.trim();

  const asset = await prisma.asset.upsert({
    where: { symbol: mapping.internalSymbol },
    update: {},
    create: { symbol: mapping.internalSymbol, name: mapping.internalSymbol },
  });

  const importLog = await prisma.marketDataImportLog.create({
    data: {
      assetId: asset.id,
      timeframe: options.timeframe,
      source,
      rangeStart: options.startDate ?? new Date(0),
      rangeEnd: options.endDate ?? new Date(),
      status: "PENDING",
    },
  });

  let rowsRead = 0;
  let rowsValid = 0;
  let inserted = 0;
  let updated = 0;
  let duplicates = 0;
  let skipped = 0;
  let invalid = 0;
  let firstTimestamp: Date | null = null;
  let lastTimestamp: Date | null = null;
  let anyRowWritten = false;
  let caughtError: string | null = null;

  try {
    const content = readFileSync(options.filePath, "utf-8");
    const { rowsRead: read, parsed, errors: parseErrors } = parseCsv(content);
    rowsRead = read;
    invalid += parseErrors.length;

    // Fase 9.1 requirement: "ordenar por timestamp" — a file is not
    // guaranteed to arrive sorted the way a paginated API response is, so
    // this is sorted explicitly before anything downstream (chronology
    // checks, range clipping, diffing) ever runs.
    const sorted = parsed.map((p) => p.bar).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const { valid, invalid: invalidCandles } = validateCandleBatch(sorted);
    invalid += invalidCandles.length;
    rowsValid = valid.length;

    const startMs = options.startDate?.getTime();
    const endMs = options.endDate?.getTime();
    const inRange = valid.filter((bar) => {
      const t = bar.timestamp.getTime();
      if (startMs !== undefined && t < startMs) return false;
      if (endMs !== undefined && t > endMs) return false;
      return true;
    });
    skipped += valid.length - inRange.length;

    if (inRange.length > 0) {
      // `inRange` is already globally sorted ascending (derived from `sorted`
      // above, filter-preserves order) — first/last are just its ends, not a
      // running min/max tracked per-row.
      firstTimestamp = inRange[0].timestamp;
      lastTimestamp = inRange[inRange.length - 1].timestamp;

      const rangeStartMs = inRange[0].timestamp.getTime();
      const rangeEndMs = inRange[inRange.length - 1].timestamp.getTime();
      const existingRows = await prisma.marketData.findMany({
        where: { assetId: asset.id, timeframe: options.timeframe, source, timestamp: { gte: new Date(rangeStartMs), lte: new Date(rangeEndMs) } },
        select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
      });
      const existingByTs = new Map(existingRows.map((r) => [r.timestamp.getTime(), r]));

      // Fase 16 — split into insert/update/unchanged BEFORE writing anything,
      // so a first-time historical import (the common case, almost always
      // 100% new rows) can go through batched `createMany()` calls instead
      // of one individual `create()` round-trip per candle. Only rows that
      // already exist with DIFFERENT values still go through individual
      // `update()` calls (Prisma/SQLite has no batched-update-by-distinct-
      // values primitive) — that path is expected to be rare (re-importing
      // an already-correct range hits `duplicates`, not `toUpdate`).
      const toInsert: OHLCVBar[] = [];
      const toUpdate: OHLCVBar[] = [];
      for (const bar of inRange) {
        const existing = existingByTs.get(bar.timestamp.getTime());
        if (!existing) {
          toInsert.push(bar);
        } else {
          const unchanged = existing.open === bar.open && existing.high === bar.high && existing.low === bar.low && existing.close === bar.close && existing.volume === bar.volume;
          if (unchanged) duplicates++;
          else toUpdate.push(bar);
        }
      }

      const INSERT_CHUNK_SIZE = 2000; // bounds any single query's row count regardless of how large the import is
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
        await prisma.marketData.createMany({
          data: chunk.map((bar) => ({
            assetId: asset.id,
            timeframe: options.timeframe,
            timestamp: bar.timestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            source,
            isDemo: false,
            quality: 100,
          })),
        });
      }
      inserted += toInsert.length;
      if (toInsert.length > 0) anyRowWritten = true;

      for (const bar of toUpdate) {
        await prisma.marketData.update({
          where: { assetId_timeframe_timestamp_source: { assetId: asset.id, timeframe: options.timeframe, timestamp: bar.timestamp, source } },
          data: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, isDemo: false, quality: 100 },
        });
        updated++;
        anyRowWritten = true;
      }
    }
  } catch (err) {
    caughtError = err instanceof Error ? err.message : String(err);
  }

  const status: OfflineImportStats["status"] = caughtError ? (anyRowWritten ? "PARTIAL" : "FAILED") : "DONE";

  await prisma.marketDataImportLog.update({
    where: { id: importLog.id },
    data: {
      rowsRequested: rowsRead,
      rowsReceived: rowsRead,
      rowsInserted: inserted,
      rowsUpdated: updated,
      rowsSkipped: skipped + duplicates,
      rowsInvalid: invalid,
      status,
      error: caughtError,
      // Fase 16 — provenance (spec section 11): when the caller didn't pass
      // explicit --start/--end, the row was created with placeholder bounds
      // (epoch 0 / "now") that say nothing about what was actually in the
      // file. Once the real content range is known, replace those
      // placeholders with the ACTUAL first/last imported timestamp so this
      // log row is useful for reconstructing which files/ranges built a
      // dataset later — never touches rows already written by a PRIOR run.
      ...(firstTimestamp && lastTimestamp ? { rangeStart: firstTimestamp, rangeEnd: lastTimestamp } : {}),
    },
  });

  return { rowsRead, rowsValid, inserted, updated, duplicates, skipped, invalid, firstTimestamp, lastTimestamp, status, error: caughtError, importLogId: importLog.id };
}
