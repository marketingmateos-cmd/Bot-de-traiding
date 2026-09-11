import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";

export interface DataQualityIssue {
  type:
    | "MISSING_BARS"
    | "BAD_TIMESTAMP_ORDER"
    | "DUPLICATE_TIMESTAMP"
    | "IMPOSSIBLE_PRICE"
    | "CORRUPT_CANDLE"
    | "SUSPICIOUS_GAP"
    | "STALE_DATA";
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}

export interface DataQualityReport {
  score: number; // 0-100
  issues: DataQualityIssue[];
  blocksTrading: boolean;
}

const TIMEFRAME_MS: Record<TimeframeCode, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

const MIN_SCORE_TO_TRADE = 55;

/**
 * Data Quality Engine (spec §7). Runs a battery of structural checks over an
 * OHLCV series and produces a 0-100 score plus a list of concrete issues.
 * Anything scoring below MIN_SCORE_TO_TRADE must block simulated order
 * generation upstream (enforced by the Trade Gate, not here — this module
 * only measures).
 */
export function evaluateDataQuality(bars: OHLCVBar[], timeframe: TimeframeCode): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  const stepMs = TIMEFRAME_MS[timeframe];

  if (bars.length === 0) {
    return { score: 0, issues: [{ type: "MISSING_BARS", severity: "HIGH", message: "No bars available." }], blocksTrading: true };
  }

  let penalty = 0;
  const seenTimestamps = new Set<number>();

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const t = bar.timestamp.getTime();

    if (seenTimestamps.has(t)) {
      issues.push({ type: "DUPLICATE_TIMESTAMP", severity: "HIGH", message: `Duplicate timestamp at index ${i}.` });
      penalty += 8;
    }
    seenTimestamps.add(t);

    if (i > 0) {
      const prevT = bars[i - 1].timestamp.getTime();
      if (t <= prevT) {
        issues.push({ type: "BAD_TIMESTAMP_ORDER", severity: "HIGH", message: `Timestamp at index ${i} is not strictly increasing.` });
        penalty += 10;
      } else {
        const gap = t - prevT;
        const missingBars = Math.round(gap / stepMs) - 1;
        if (missingBars > 0) {
          issues.push({
            type: "MISSING_BARS",
            severity: missingBars > 3 ? "HIGH" : "MEDIUM",
            message: `${missingBars} bar(s) missing before index ${i}.`,
          });
          penalty += Math.min(20, missingBars * 2);
        }
        if (gap > stepMs * 10) {
          issues.push({ type: "SUSPICIOUS_GAP", severity: "HIGH", message: `Suspiciously large gap (${Math.round(gap / stepMs)}x expected) before index ${i}.` });
          penalty += 12;
        }
      }
    }

    const { open, high, low, close, volume } = bar;
    const positive = open > 0 && high > 0 && low > 0 && close > 0;
    const orderedHighLow = high >= low;
    const highIsMax = high >= Math.max(open, close);
    const lowIsMin = low <= Math.min(open, close);
    if (!positive || !orderedHighLow || !highIsMax || !lowIsMin) {
      issues.push({ type: "IMPOSSIBLE_PRICE", severity: "HIGH", message: `Impossible OHLC relationship at index ${i}.` });
      penalty += 15;
    }
    if (volume < 0 || !Number.isFinite(volume)) {
      issues.push({ type: "CORRUPT_CANDLE", severity: "HIGH", message: `Invalid volume at index ${i}.` });
      penalty += 10;
    }
    if (i > 0) {
      const prevClose = bars[i - 1].close;
      const change = Math.abs(close - prevClose) / prevClose;
      if (change > 0.5) {
        issues.push({ type: "IMPOSSIBLE_PRICE", severity: "MEDIUM", message: `Implausible ${(change * 100).toFixed(0)}% single-bar move at index ${i}.` });
        penalty += 6;
      }
    }
  }

  const lastBarAge = Date.now() - bars[bars.length - 1].timestamp.getTime();
  if (lastBarAge > stepMs * 3) {
    issues.push({ type: "STALE_DATA", severity: "MEDIUM", message: `Latest bar is ${Math.round(lastBarAge / stepMs)}x the expected interval old.` });
    penalty += 10;
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { score, issues, blocksTrading: score < MIN_SCORE_TO_TRADE };
}

export { MIN_SCORE_TO_TRADE };
