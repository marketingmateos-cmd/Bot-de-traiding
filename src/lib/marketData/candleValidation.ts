import type { OHLCVBar } from "@/lib/providers/types";

/**
 * Fase 9 — hard, reject-not-score validation for the IMPORTER, run once per
 * batch before anything touches the database. This is deliberately
 * separate from `dataQuality.ts`'s `evaluateDataQuality` (a 0-100 score
 * used to gate live trading on an already-trusted series) and from
 * `replayDataQuality.ts`'s `evaluateHistoricalDataQuality` (a report over
 * an already-fetched, already-trusted series) — this one's job is to catch
 * a genuinely malformed candle from an external API BEFORE it is ever
 * written to `MarketData`, so invalid rows never enter storage silently.
 */
export interface InvalidCandle {
  bar: OHLCVBar;
  reasons: string[];
}

export interface CandleValidationResult {
  valid: OHLCVBar[];
  invalid: InvalidCandle[];
  duplicateTimestamps: number;
  chronologyViolations: number;
}

function validateOneCandle(bar: OHLCVBar): string[] {
  const reasons: string[] = [];

  if (!(bar.timestamp instanceof Date) || Number.isNaN(bar.timestamp.getTime())) {
    reasons.push("timestamp inválido");
  }
  for (const [name, value] of [
    ["open", bar.open],
    ["high", bar.high],
    ["low", bar.low],
    ["close", bar.close],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) reasons.push(`${name} debe ser un número finito positivo (recibido: ${value})`);
  }
  if (!Number.isFinite(bar.volume) || bar.volume < 0) reasons.push(`volume debe ser un número finito >= 0 (recibido: ${bar.volume})`);

  // Only run the OHLC-relationship checks when every price is at least a
  // finite number — otherwise a NaN would make every comparison below
  // silently false and this could pass a broken candle by accident.
  const pricesFinite = [bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v));
  if (pricesFinite) {
    if (!(bar.high >= bar.low)) reasons.push(`high (${bar.high}) debe ser >= low (${bar.low})`);
    if (!(bar.high >= bar.open)) reasons.push(`high (${bar.high}) debe ser >= open (${bar.open})`);
    if (!(bar.high >= bar.close)) reasons.push(`high (${bar.high}) debe ser >= close (${bar.close})`);
    if (!(bar.low <= bar.open)) reasons.push(`low (${bar.low}) debe ser <= open (${bar.open})`);
    if (!(bar.low <= bar.close)) reasons.push(`low (${bar.low}) debe ser <= close (${bar.close})`);
  }

  return reasons;
}

/**
 * Validates a batch of candles that are ALREADY expected to be in
 * ascending chronological order (as returned by the Binance client) —
 * still checks that this actually holds rather than trusting the caller,
 * and separately flags duplicate timestamps. Invalid candles are removed
 * from `valid`, never silently kept.
 */
export function validateCandleBatch(bars: OHLCVBar[]): CandleValidationResult {
  const valid: OHLCVBar[] = [];
  const invalid: InvalidCandle[] = [];
  let duplicateTimestamps = 0;
  let chronologyViolations = 0;
  const seenTimestamps = new Set<number>();
  let lastValidTimestamp = -Infinity;

  for (const bar of bars) {
    const reasons = validateOneCandle(bar);
    const t = bar.timestamp instanceof Date ? bar.timestamp.getTime() : NaN;

    if (!Number.isNaN(t)) {
      if (seenTimestamps.has(t)) {
        duplicateTimestamps++;
        reasons.push("timestamp duplicado dentro del mismo lote");
      }
      seenTimestamps.add(t);
      if (t <= lastValidTimestamp) {
        chronologyViolations++;
        reasons.push(`fuera de orden cronológico (timestamp ${t} <= anterior ${lastValidTimestamp})`);
      }
    }

    if (reasons.length > 0) {
      invalid.push({ bar, reasons });
      continue;
    }
    valid.push(bar);
    lastValidTimestamp = t;
  }

  return { valid, invalid, duplicateTimestamps, chronologyViolations };
}
