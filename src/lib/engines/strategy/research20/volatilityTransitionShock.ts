import { atr } from "../../features";
import { detectRegime } from "../../regime";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";

/**
 * Fase 20 — Family B: Volatility Regime Transition Shock. Formulas/params
 * frozen BEFORE any Discovery/Validation run in
 * `research/phase20PreRegistration.ts` (`F20B_PARAMS`) — this file only
 * implements that pre-registered logic (spec Condición 1).
 *
 * Hypothesis: a market that was structurally calm (LOW_VOLATILITY regime,
 * per the existing Regime Engine) and abruptly transitions into
 * HIGH_VOLATILITY within a short `transitionWindowBars` window is
 * experiencing a genuine "shock" — a regime change, not routine noise —
 * and the direction of that shock (the net price move across the
 * transition window) may have more continuation than an ordinary
 * volatility spike with no prior calm regime to contrast against.
 * Deliberately distinct from F17-A (Volatility Squeeze): F17-A reacts to a
 * range breakout after ATR-percentile compression on a single prior bar;
 * this strategy reacts to a REGIME-LEVEL transition (via `detectRegime`,
 * which also folds in trend/range structure, not ATR alone) across a
 * multi-bar window, and trades in the direction of the shock itself
 * rather than a breakout level.
 *
 * Both regime reads are strictly causal: `priorRegime` is computed on
 * `bars` truncated to exclude the last `transitionWindowBars` bars (so it
 * reflects the state BEFORE the transition window even started), and
 * `currentRegime` is computed on all bars up to and including the current
 * one — never on anything after it.
 */
export const volatilityTransitionShockStrategy: StrategyDefinition = {
  id: "research20-volatility-transition-shock-v1",
  kind: "VOLATILITY_TRANSITION_SHOCK",
  name: "Volatility Regime Transition Shock (Fase 20-B)",
  version: "1.0",
  defaultParams: { transitionWindowBars: 3, volatilityPeriod: 14, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const transitionWindowBars = Number(params.transitionWindowBars ?? 3);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const rrr = Number(params.rrr ?? 1.5);

    // detectRegime itself needs >= 60 bars to leave its low-confidence
    // TRANSITION fallback; we need that satisfied for BOTH the prior-window
    // read (which has transitionWindowBars fewer bars) and the current one.
    const minBars = 60 + transitionWindowBars + volatilityPeriod;
    if (bars.length < minBars) return null;

    const priorBars = bars.slice(0, bars.length - transitionWindowBars);
    const priorRegime = detectRegime(priorBars).regime;
    const currentRegime = detectRegime(bars).regime;

    if (priorRegime !== "LOW_VOLATILITY" || currentRegime !== "HIGH_VOLATILITY") return null;

    const current = bars[bars.length - 1];
    const reference = bars[bars.length - 1 - transitionWindowBars];
    const priceChange = current.close - reference.close;
    if (priceChange === 0) return null;

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;

    const direction = priceChange > 0 ? "LONG" : "SHORT";
    const stopLossPrice = direction === "LONG" ? current.close - stopDistance : current.close + stopDistance;
    const takeProfitPrice = direction === "LONG" ? current.close + stopDistance * rrr : current.close - stopDistance * rrr;

    return {
      kind: "VOLATILITY_TRANSITION_SHOCK",
      direction,
      strength: Math.min(1, Math.abs(priceChange) / Math.max(1e-9, stopDistance)),
      reason: `Transición de régimen LOW_VOLATILITY -> HIGH_VOLATILITY en ${transitionWindowBars} velas, con movimiento neto de precio ${priceChange > 0 ? "alcista" : "bajista"} (${priceChange.toFixed(2)}).`,
      stopLossPrice,
      takeProfitPrice,
      meta: { priorRegime, currentRegime, priceChange, stopDistance, rrr },
    };
  },
};
