import type { SentimentPoint } from "@/lib/providers/types";

export interface SentimentAnalysis {
  current: number; // -1..1
  trend: number; // slope per point, recent window
  acceleration: number; // change in slope
  divergence: boolean;
  divergenceMagnitude: number; // 0..2, |priceChangePct/100 - sentimentChange|
  score: number; // 0-100 component for Market Intelligence
}

/**
 * Sentiment Engine (spec §11). Derives trend + acceleration from a sentiment
 * time series and flags sentiment/price divergence — the classic
 * "price up, sentiment down" (or vice versa) warning sign.
 */
export function analyzeSentiment(history: SentimentPoint[], priceChangePct: number): SentimentAnalysis {
  if (history.length === 0) {
    return { current: 0, trend: 0, acceleration: 0, divergence: false, divergenceMagnitude: 0, score: 50 };
  }

  const scores = history.map((h) => h.score);
  const current = scores[scores.length - 1];

  const windowSize = Math.min(10, scores.length);
  const recentWindow = scores.slice(-windowSize);
  const trend = linearSlope(recentWindow);

  const prevWindow = scores.slice(-windowSize * 2, -windowSize);
  const prevTrend = prevWindow.length >= 2 ? linearSlope(prevWindow) : trend;
  const acceleration = trend - prevTrend;

  // Normalize sentiment change over the window to the same "percent-like"
  // scale as price change to make divergence comparable.
  const sentimentChangePct = (current - recentWindow[0]) * 100;
  const divergenceMagnitude = Math.abs(priceChangePct - sentimentChangePct) / 100;
  const divergence = Math.sign(priceChangePct) !== Math.sign(sentimentChangePct) && Math.abs(priceChangePct) > 1 && Math.abs(sentimentChangePct) > 3;

  const score = Math.round(Math.max(0, Math.min(100, 50 + current * 50)));

  return { current, trend, acceleration, divergence, divergenceMagnitude, score };
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
