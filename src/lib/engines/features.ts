import type { OHLCVBar } from "@/lib/providers/types";

/**
 * Feature Engine — real technical-indicator math (no placeholders). Every
 * function returns an array aligned 1:1 with the input bars; indices without
 * enough lookback are `null` rather than a fabricated number, so callers can
 * tell "not enough history yet" from "zero".
 */

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev === null) {
      const slice = values.slice(i - period + 1, i + 1);
      prev = slice.reduce((a, b) => a + b, 0) / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  );
  const macdValuesForSignal = macdLine.map((v) => v ?? 0);
  const signalRaw = ema(macdValuesForSignal, signalPeriod);
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signal = signalRaw.map((v, i) => (i < firstValid + signalPeriod - 1 ? null : v));
  const histogram = macdLine.map((v, i) => (v !== null && signal[i] !== null ? v - (signal[i] as number) : null));
  return { macdLine, signal, histogram };
}

export function atr(bars: OHLCVBar[], period = 14): (number | null)[] {
  const trs: number[] = bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const prevClose = bars[i - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
  return sma(trs, period);
}

export function bollingerBands(closes: number[], period = 20, stdDevMultiplier = 2) {
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i] as number;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
  }
  return { mid, upper, lower };
}

export function realizedVolatility(closes: number[], period = 20): (number | null)[] {
  const returns = closes.map((c, i) => (i === 0 ? 0 : Math.log(c / closes[i - 1])));
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const slice = returns.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (period - 1);
    out[i] = Math.sqrt(variance) * Math.sqrt(365); // annualized, daily-bar convention
  }
  return out;
}

export function zScore(values: number[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    out[i] = stdDev === 0 ? 0 : (values[i] - mean) / stdDev;
  }
  return out;
}

export interface FeatureSnapshot {
  close: number;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi14: number | null;
  macdHistogram: number | null;
  atr14: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  volatility20: number | null;
  volumeZScore20: number | null;
  trend: number; // -1..1 composite
  momentum: number; // -1..1 composite
}

/** Computes the full indicator set and returns only the latest snapshot, aligned with the last bar. */
export function computeLatestFeatures(bars: OHLCVBar[]): FeatureSnapshot | null {
  if (bars.length < 5) return null;
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const last = bars.length - 1;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema20 = ema(closes, 20);
  const rsiArr = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrArr = atr(bars, 14);
  const { upper, lower } = bollingerBands(closes, 20);
  const vol20 = realizedVolatility(closes, 20);
  const volZ = zScore(volumes, 20);

  const price = closes[last];
  const trendRaw = sma20[last] !== null && sma50[last] !== null ? ((sma20[last] as number) - (sma50[last] as number)) / price : 0;
  const trend = Math.max(-1, Math.min(1, trendRaw * 20));

  const momentumRaw = rsiArr[last] !== null ? ((rsiArr[last] as number) - 50) / 50 : 0;
  const momentum = Math.max(-1, Math.min(1, momentumRaw));

  return {
    close: price,
    sma20: sma20[last],
    sma50: sma50[last],
    ema20: ema20[last],
    rsi14: rsiArr[last],
    macdHistogram: histogram[last],
    atr14: atrArr[last],
    bbUpper: upper[last],
    bbLower: lower[last],
    volatility20: vol20[last],
    volumeZScore20: volZ[last],
    trend,
    momentum,
  };
}
