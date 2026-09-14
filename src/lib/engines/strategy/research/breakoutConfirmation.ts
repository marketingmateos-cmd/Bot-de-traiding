import { atr, zScore } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";

/**
 * Fase 17 — Family D: Breakout + Confirmation. Hypothesis and parameter
 * justification live in `./hypothesisRegistry.ts`. Shares the EXACT same
 * breakout core as Breakout Baseline (Fase 11) — same lookback/ATR/RRR —
 * plus two additional, purely-causal confirmations computed from the
 * CURRENT bar's own OHLCV only: (a) the close must sit in the strong part
 * of that bar's own range, (b) that bar's own volume must be anomalously
 * high. Both are information already available at the instant of decision
 * (the same instant the bar's own close is used); nothing here reads a
 * future bar.
 */
export const breakoutConfirmationStrategy: StrategyDefinition = {
  id: "research-breakout-confirmation-v1",
  kind: "BREAKOUT_CONFIRMATION",
  name: "Breakout + Confirmation (Fase 17)",
  version: "1.0",
  defaultParams: { lookback: 20, volatilityPeriod: 14, atrMultiplier: 1.5, rrr: 1.5, closePositionThreshold: 0.7, volumeZThreshold: 1 },
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
    const closePositionThreshold = Number(params.closePositionThreshold ?? 0.7);
    const volumeZThreshold = Number(params.volumeZThreshold ?? 1);

    const volumeZPeriod = 20; // same convention as the Feature Engine's own volumeZScore20
    if (bars.length < Math.max(lookback, volumeZPeriod) + 1) return null;

    // REGLA ABSOLUTA (mirrors breakoutBaseline.ts exactly): the lookback
    // window EXCLUDES the current bar.
    const window = bars.slice(-lookback - 1, -1);
    const highestHigh = Math.max(...window.map((b) => b.high));
    const lowestLow = Math.min(...window.map((b) => b.low));
    const current = bars[bars.length - 1];

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    const barRange = current.high - current.low;
    if (barRange <= 0) return null;

    const volumes = bars.map((b) => b.volume);
    const volZArr = zScore(volumes, volumeZPeriod);
    const volumeZ = volZArr[volZArr.length - 1];
    if (volumeZ === null) return null;

    if (current.close > highestHigh) {
      const closePosition = (current.close - current.low) / barRange;
      if (closePosition < closePositionThreshold || volumeZ < volumeZThreshold) return null;
      return {
        kind: "BREAKOUT_CONFIRMATION",
        direction: "LONG",
        strength: Math.min(1, 0.5 + (current.close - highestHigh) / Math.max(1e-9, stopDistance)),
        reason: `Ruptura alcista de ${lookback} velas confirmada: cierre en el ${(closePosition * 100).toFixed(0)}% superior del rango de la vela y volumen z=${volumeZ.toFixed(2)}.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { breakoutLevel: highestHigh, closePosition, volumeZ, stopDistance, rrr },
      };
    }
    if (current.close < lowestLow) {
      const closePosition = (current.high - current.close) / barRange;
      if (closePosition < closePositionThreshold || volumeZ < volumeZThreshold) return null;
      return {
        kind: "BREAKOUT_CONFIRMATION",
        direction: "SHORT",
        strength: Math.min(1, 0.5 + (lowestLow - current.close) / Math.max(1e-9, stopDistance)),
        reason: `Ruptura bajista de ${lookback} velas confirmada: cierre en el ${(closePosition * 100).toFixed(0)}% inferior del rango de la vela y volumen z=${volumeZ.toFixed(2)}.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { breakoutLevel: lowestLow, closePosition, volumeZ, stopDistance, rrr },
      };
    }
    return null;
  },
};
