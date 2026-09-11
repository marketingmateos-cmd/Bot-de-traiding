import type { StrategyDefinition } from "./types";

export const breakoutStrategy: StrategyDefinition = {
  id: "breakout",
  kind: "BREAKOUT",
  name: "Range Breakout",
  version: "1.0",
  defaultParams: { lookback: 20, volumeZMin: 0.75 },
  timeframe: "H1",
  recommendedRegimes: ["RANGE", "LOW_VOLATILITY", "TRANSITION"],
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 4,
  defaultTrailingStopPct: 1.5,
  costModel: { feeBps: 10, slippageBps: 8 },
  evaluate(bars, features, params) {
    const lookback = Number(params.lookback ?? 20);
    const volumeZMin = Number(params.volumeZMin ?? 0.75);
    if (bars.length < lookback + 1) return null;

    const window = bars.slice(-lookback - 1, -1); // exclude current bar to avoid look-ahead
    const highestHigh = Math.max(...window.map((b) => b.high));
    const lowestLow = Math.min(...window.map((b) => b.low));
    const current = bars[bars.length - 1];
    const volumeConfirmed = (features.volumeZScore20 ?? 0) >= volumeZMin;

    if (current.close > highestHigh && volumeConfirmed) {
      return {
        kind: "BREAKOUT",
        direction: "LONG",
        strength: Math.min(1, 0.5 + (features.volumeZScore20 ?? 0) / 4),
        reason: `El cierre ${current.close.toFixed(2)} rompió por encima del máximo de ${lookback} velas (${highestHigh.toFixed(2)}) con volumen de confirmación.`,
      };
    }
    if (current.close < lowestLow && volumeConfirmed) {
      return {
        kind: "BREAKOUT",
        direction: "SHORT",
        strength: Math.min(1, 0.5 + (features.volumeZScore20 ?? 0) / 4),
        reason: `El cierre ${current.close.toFixed(2)} rompió por debajo del mínimo de ${lookback} velas (${lowestLow.toFixed(2)}) con volumen de confirmación.`,
      };
    }
    return null;
  },
};
