import { atr, rsi } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";

/**
 * Fase 17 — Family E: Momentum Reversal. Hypothesis and parameter
 * justification live in `./hypothesisRegistry.ts`. Structurally distinct
 * from Mean Reversion Baseline (Fase 11), which trades a z-score DISTANCE
 * from a rolling mean: this strategy instead requires (a) RSI in an
 * extreme zone and (b) the most recent bar-to-bar move to be SMALLER in
 * magnitude than the one before it — a deceleration/exhaustion condition,
 * never a distance-from-mean condition. Both checks use only the current
 * bar and strictly-prior bars.
 */
export const momentumReversalStrategy: StrategyDefinition = {
  id: "research-momentum-reversal-v1",
  kind: "MOMENTUM_REVERSAL",
  name: "Momentum Exhaustion Reversal (Fase 17)",
  version: "1.0",
  defaultParams: { rsiPeriod: 14, rsiOverbought: 75, rsiOversold: 25, volatilityPeriod: 14, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const rsiPeriod = Number(params.rsiPeriod ?? 14);
    const rsiOverbought = Number(params.rsiOverbought ?? 75);
    const rsiOversold = Number(params.rsiOversold ?? 25);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const rrr = Number(params.rrr ?? 1.5);

    if (bars.length < rsiPeriod + 3) return null;

    const closes = bars.map((b) => b.close);
    const rsiArr = rsi(closes, rsiPeriod);
    const currentRsi = rsiArr[rsiArr.length - 1];
    if (currentRsi === null) return null;

    const current = bars[bars.length - 1];
    const previous = bars[bars.length - 2];
    const beforePrevious = bars[bars.length - 3];

    const lastMove = Math.abs(current.close - previous.close);
    const priorMove = Math.abs(previous.close - beforePrevious.close);
    if (!(lastMove < priorMove)) return null; // no deceleration — the move is still accelerating, no exhaustion signal

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;

    if (currentRsi >= rsiOverbought) {
      return {
        kind: "MOMENTUM_REVERSAL",
        direction: "SHORT",
        strength: Math.min(1, (currentRsi - rsiOverbought) / (100 - rsiOverbought) + 0.4),
        reason: `RSI(${rsiPeriod})=${currentRsi.toFixed(1)} en sobrecompra con desaceleración del movimiento (${lastMove.toFixed(2)} < ${priorMove.toFixed(2)}) — posible agotamiento.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { rsi: currentRsi, lastMove, priorMove, stopDistance, rrr },
      };
    }
    if (currentRsi <= rsiOversold) {
      return {
        kind: "MOMENTUM_REVERSAL",
        direction: "LONG",
        strength: Math.min(1, (rsiOversold - currentRsi) / rsiOversold + 0.4),
        reason: `RSI(${rsiPeriod})=${currentRsi.toFixed(1)} en sobreventa con desaceleración del movimiento (${lastMove.toFixed(2)} < ${priorMove.toFixed(2)}) — posible agotamiento.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { rsi: currentRsi, lastMove, priorMove, stopDistance, rrr },
      };
    }
    return null;
  },
};
