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

/** Pure digits only — epoch. 13 digits is milliseconds, 10 digits is seconds; anything else is ambiguous and rejected rather than guessed. */
function parseEpochDigits(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  if (raw.length === 13) return Number(raw);
  if (raw.length === 10) return Number(raw) * 1000;
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
    return { error: `timestamp numérico con ${trimmed.length} dígitos — no se puede determinar de forma inequívoca si es epoch en segundos (10) o milisegundos (13); nunca se adivina` };
  }

  if (ISO_8601_PATTERN.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) return { error: `no se pudo interpretar "${trimmed}" como fecha ISO-8601 válida` };
    return { ms };
  }

  return { error: `formato de timestamp no reconocido: "${trimmed}" (se aceptan ISO-8601 o epoch de 10/13 dígitos)` };
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

/**
 * Minimal CSV parser for exactly the documented format:
 * `timestamp,open,high,low,close,volume` (header required, columns in
 * this exact order, one candle per line). No quoting/escaping support —
 * a market-data OHLCV export never needs it, and refusing anything else
 * keeps "can the format be determined unambiguously" a hard yes/no rather
 * than a guess.
 */
function parseCsv(content: string): CsvParseResult {
  const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("CSV vacío: no se encontró ni siquiera la línea de cabecera.");
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const expected = CSV_HEADER as readonly string[];
  if (header.length !== expected.length || !expected.every((h, i) => header[i] === h)) {
    throw new Error(`Cabecera de CSV no reconocida. Se esperaba exactamente: "${expected.join(",")}". Se recibió: "${lines[0]}"`);
  }

  const dataLines = lines.slice(1);
  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const lineNumber = i + 2; // 1-indexed, +1 for the header row
    const cols = dataLines[i].split(",");
    if (cols.length !== 6) {
      errors.push({ line: lineNumber, reason: `se esperaban 6 columnas, se encontraron ${cols.length}` });
      continue;
    }
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
      const rangeStartMs = inRange[0].timestamp.getTime();
      const rangeEndMs = inRange[inRange.length - 1].timestamp.getTime();
      const existingRows = await prisma.marketData.findMany({
        where: { assetId: asset.id, timeframe: options.timeframe, source, timestamp: { gte: new Date(rangeStartMs), lte: new Date(rangeEndMs) } },
        select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
      });
      const existingByTs = new Map(existingRows.map((r) => [r.timestamp.getTime(), r]));

      for (const bar of inRange) {
        const ts = bar.timestamp.getTime();
        const existing = existingByTs.get(ts);
        if (existing) {
          const unchanged = existing.open === bar.open && existing.high === bar.high && existing.low === bar.low && existing.close === bar.close && existing.volume === bar.volume;
          if (unchanged) {
            duplicates++;
          } else {
            await prisma.marketData.update({
              where: { assetId_timeframe_timestamp_source: { assetId: asset.id, timeframe: options.timeframe, timestamp: bar.timestamp, source } },
              data: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, isDemo: false, quality: 100 },
            });
            updated++;
            anyRowWritten = true;
          }
        } else {
          await prisma.marketData.create({
            data: {
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
            },
          });
          inserted++;
          anyRowWritten = true;
        }
        if (firstTimestamp === null || bar.timestamp < firstTimestamp) firstTimestamp = bar.timestamp;
        if (lastTimestamp === null || bar.timestamp > lastTimestamp) lastTimestamp = bar.timestamp;
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
    },
  });

  return { rowsRead, rowsValid, inserted, updated, duplicates, skipped, invalid, firstTimestamp, lastTimestamp, status, error: caughtError, importLogId: importLog.id };
}
