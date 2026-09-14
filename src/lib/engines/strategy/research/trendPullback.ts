import { atr, sma } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";

/**
 * Fase 17 — Family C: Trend + Pullback. Hypothesis and parameter
 * justification live in `./hypothesisRegistry.ts`. Deliberately kept as 3
 * SEPARATE, sequential causal stages (never collapsed into one condition):
 * (1) TREND DETECTION via the same fast/slow SMA convention as Trend
 * Following Baseline (Fase 11), (2) PULLBACK — a net retracement over the
 * `pullbackBars` bars strictly BEFORE the current one, (3) CONFIRMATION —
 * the current bar itself must resume in the trend's direction relative to
 * the immediately preceding bar. Only when all three hold does it fire —
 * chasing an extension with no pullback never fires here.
 */
export const trendPullbackStrategy: StrategyDefinition = {
  id: "research-trend-pullback-v1",
  kind: "TREND_PULLBACK",
  name: "Trend + Pullback Entry (Fase 17)",
  version: "1.0",
  defaultParams: { fastPeriod: 20, slowPeriod: 50, pullbackBars: 3, volatilityPeriod: 14, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const fastPeriod = Number(params.fastPeriod ?? 20);
    const slowPeriod = Number(params.slowPeriod ?? 50);
    const pullbackBars = Number(params.pullbackBars ?? 3);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const rrr = Number(params.rrr ?? 1.5);

    const minBars = slowPeriod + pullbackBars + 2;
    if (bars.length < minBars) return null;

    const closes = bars.map((b) => b.close);
    const fastArr = sma(closes, fastPeriod);
    const slowArr = sma(closes, slowPeriod);
    const fastMa = fastArr[fastArr.length - 1];
    const slowMa = slowArr[slowArr.length - 1];
    if (fastMa === null || slowMa === null) return null;

    const current = bars[bars.length - 1];
    const previous = bars[bars.length - 2];
    // Stage (2) window: pullbackBars bars strictly BEFORE the current bar, ending at `previous`.
    const pullbackStart = bars[bars.length - 2 - pullbackBars];

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;

    if (fastMa > slowMa) {
      const pulledBack = previous.close < pullbackStart.close;
      const resumed = current.close > previous.close && current.close > fastMa;
      if (pulledBack && resumed) {
        return {
          kind: "TREND_PULLBACK",
          direction: "LONG",
          strength: Math.min(1, (current.close - previous.close) / Math.max(1e-9, stopDistance)),
          reason: `Tendencia alcista (SMA${fastPeriod} > SMA${slowPeriod}) con retroceso de ${pullbackBars} velas y confirmación de reanudación.`,
          stopLossPrice: current.close - stopDistance,
          takeProfitPrice: current.close + stopDistance * rrr,
          meta: { fastMa, slowMa, stopDistance, rrr },
        };
      }
      return null;
    }
    if (fastMa < slowMa) {
      const pulledBack = previous.close > pullbackStart.close;
      const resumed = current.close < previous.close && current.close < fastMa;
      if (pulledBack && resumed) {
        return {
          kind: "TREND_PULLBACK",
          direction: "SHORT",
          strength: Math.min(1, (previous.close - current.close) / Math.max(1e-9, stopDistance)),
          reason: `Tendencia bajista (SMA${fastPeriod} < SMA${slowPeriod}) con retroceso de ${pullbackBars} velas y confirmación de reanudación.`,
          stopLossPrice: current.close + stopDistance,
          takeProfitPrice: current.close - stopDistance * rrr,
          meta: { fastMa, slowMa, stopDistance, rrr },
        };
      }
      return null;
    }
    return null;
  },
};
