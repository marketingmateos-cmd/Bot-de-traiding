import { atr } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "./shared";

/**
 * Fase 11 — BreakoutBaselineStrategy. A simple, transparent range-breakout:
 * enter when the current bar's close breaks above the highest high (LONG)
 * or below the lowest low (SHORT) of the `lookback` bars BEFORE it. Stop is
 * volatility-based (ATR * atrMultiplier); target is stop-distance * RRR.
 * No optimization: these are reasonable, explicit constants, not a fitted
 * result (spec section 3/17).
 */
export const breakoutBaselineStrategy: StrategyDefinition = {
  id: "breakout-baseline-v1",
  kind: "BREAKOUT",
  name: "Breakout Baseline (Fase 11)",
  version: "1.0",
  defaultParams: { lookback: 20, volatilityPeriod: 14, atrMultiplier: 1.5, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const lookback = Number(params.lookback ?? 20);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const atrMultiplier = Number(params.atrMultiplier ?? 1.5);
    const rrr = Number(params.rrr ?? 1.5);

    if (bars.length < lookback + 1) return null;

    // REGLA ABSOLUTA: the lookback window EXCLUDES the current bar — a
    // breakout is a comparison against bars strictly before it, never
    // including its own high/low (which would let the current bar "break
    // out" against itself).
    const window = bars.slice(-lookback - 1, -1);
    const highestHigh = Math.max(...window.map((b) => b.high));
    const lowestLow = Math.min(...window.map((b) => b.low));
    const current = bars[bars.length - 1];

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null; // not enough history for a real volatility read — never guess a stop distance

    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    if (current.close > highestHigh) {
      const stopLossPrice = current.close - stopDistance;
      const takeProfitPrice = current.close + stopDistance * rrr;
      return {
        kind: "BREAKOUT",
        direction: "LONG",
        strength: Math.min(1, 0.5 + (current.close - highestHigh) / Math.max(1e-9, stopDistance)),
        reason: `El cierre ${current.close.toFixed(2)} rompió por encima del máximo de ${lookback} velas anteriores (${highestHigh.toFixed(2)}); stop ATR(${volatilityPeriod})×${atrMultiplier}.`,
        stopLossPrice,
        takeProfitPrice,
        meta: { breakoutLevel: highestHigh, direction: "LONG", stopDistance, rrr },
      };
    }
    if (current.close < lowestLow) {
      const stopLossPrice = current.close + stopDistance;
      const takeProfitPrice = current.close - stopDistance * rrr;
      return {
        kind: "BREAKOUT",
        direction: "SHORT",
        strength: Math.min(1, 0.5 + (lowestLow - current.close) / Math.max(1e-9, stopDistance)),
        reason: `El cierre ${current.close.toFixed(2)} rompió por debajo del mínimo de ${lookback} velas anteriores (${lowestLow.toFixed(2)}); stop ATR(${volatilityPeriod})×${atrMultiplier}.`,
        stopLossPrice,
        takeProfitPrice,
        meta: { breakoutLevel: lowestLow, direction: "SHORT", stopDistance, rrr },
      };
    }
    return null;
  },
};
