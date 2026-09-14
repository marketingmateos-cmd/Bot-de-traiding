import { atr, sma } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "./shared";

/**
 * Fase 11 — TrendFollowingBaselineStrategy. A simple, explicit moving-average
 * crossover: fastPeriod SMA above slowPeriod SMA means an uptrend (LONG);
 * below means a downtrend (SHORT). Stop is volatility-based (ATR); target is
 * stop-distance * RRR.
 */
export const trendFollowingBaselineStrategy: StrategyDefinition = {
  id: "trend-following-baseline-v1",
  kind: "TREND_FOLLOWING",
  name: "Trend Following Baseline (Fase 11)",
  version: "1.0",
  defaultParams: { fastPeriod: 20, slowPeriod: 50, volatilityPeriod: 14, rrr: 2 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 3,
  defaultTakeProfitPct: 6,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const fastPeriod = Number(params.fastPeriod ?? 20);
    const slowPeriod = Number(params.slowPeriod ?? 50);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const rrr = Number(params.rrr ?? 2);

    if (bars.length < slowPeriod + 1) return null;

    const closes = bars.map((b) => b.close);
    const fastArr = sma(closes, fastPeriod);
    const slowArr = sma(closes, slowPeriod);
    const fastMa = fastArr[fastArr.length - 1];
    const slowMa = slowArr[slowArr.length - 1];
    if (fastMa === null || slowMa === null) return null;

    const current = bars[bars.length - 1];
    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;
    if (stopDistance <= 0) return null;

    if (fastMa > slowMa) {
      return {
        kind: "TREND_FOLLOWING",
        direction: "LONG",
        strength: Math.min(1, Math.abs(fastMa - slowMa) / Math.max(1e-9, slowMa) / 0.02),
        reason: `SMA(${fastPeriod}) ${fastMa.toFixed(2)} por encima de SMA(${slowPeriod}) ${slowMa.toFixed(2)}.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { fastMa, slowMa, stopDistance, rrr },
      };
    }
    if (fastMa < slowMa) {
      return {
        kind: "TREND_FOLLOWING",
        direction: "SHORT",
        strength: Math.min(1, Math.abs(fastMa - slowMa) / Math.max(1e-9, slowMa) / 0.02),
        reason: `SMA(${fastPeriod}) ${fastMa.toFixed(2)} por debajo de SMA(${slowPeriod}) ${slowMa.toFixed(2)}.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { fastMa, slowMa, stopDistance, rrr },
      };
    }
    return null;
  },
};
