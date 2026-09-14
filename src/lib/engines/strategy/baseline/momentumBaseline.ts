import { atr } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "./shared";

/**
 * Fase 11 — MomentumBaselineStrategy. Measures the price return over the
 * last `lookback` bars (current bar's close vs. the close `lookback` bars
 * before it — never a future bar); a return beyond `momentumThreshold`
 * (as a fraction, e.g. 0.02 = 2%) fires in the direction of that move.
 * Stop is volatility-based (ATR); target is stop-distance * RRR.
 */
export const momentumBaselineStrategy: StrategyDefinition = {
  id: "momentum-baseline-v1",
  kind: "MOMENTUM",
  name: "Momentum Baseline (Fase 11)",
  version: "1.0",
  defaultParams: { lookback: 10, momentumThreshold: 0.02, volatilityPeriod: 14, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2.5,
  defaultTakeProfitPct: 3.75,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const lookback = Number(params.lookback ?? 10);
    const momentumThreshold = Number(params.momentumThreshold ?? 0.02);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const rrr = Number(params.rrr ?? 1.5);

    if (bars.length < lookback + 1) return null;

    const current = bars[bars.length - 1];
    const pastBar = bars[bars.length - 1 - lookback]; // strictly a PAST bar, never the current one
    if (pastBar.close <= 0) return null;
    const momentumReturn = (current.close - pastBar.close) / pastBar.close;

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;
    if (stopDistance <= 0) return null;

    if (momentumReturn > momentumThreshold) {
      return {
        kind: "MOMENTUM",
        direction: "LONG",
        strength: Math.min(1, momentumReturn / (momentumThreshold * 3)),
        reason: `Retorno de ${(momentumReturn * 100).toFixed(2)}% en las últimas ${lookback} velas, por encima del umbral ${(momentumThreshold * 100).toFixed(2)}%.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { momentumPct: momentumReturn * 100, stopDistance, rrr },
      };
    }
    if (momentumReturn < -momentumThreshold) {
      return {
        kind: "MOMENTUM",
        direction: "SHORT",
        strength: Math.min(1, Math.abs(momentumReturn) / (momentumThreshold * 3)),
        reason: `Retorno de ${(momentumReturn * 100).toFixed(2)}% en las últimas ${lookback} velas, por debajo del umbral -${(momentumThreshold * 100).toFixed(2)}%.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { momentumPct: momentumReturn * 100, stopDistance, rrr },
      };
    }
    return null;
  },
};
