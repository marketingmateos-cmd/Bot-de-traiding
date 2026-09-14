import type { Regime } from "../../regime";

/**
 * Fase 11 — Strategy Research & Evaluation Benchmark. Every baseline
 * strategy lists ALL regimes as "recommended" so the Trade Gate's
 * REGIME_CHECK step never favors one family over another for reasons
 * unrelated to its own signal quality — the benchmark is meant to compare
 * the four families on equal footing (spec section 8), and an uneven
 * regime allow-list would quietly bias that comparison before a single
 * trade is even sized.
 */
export const ALL_REGIMES: Regime[] = ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR", "HIGH_VOLATILITY", "LOW_VOLATILITY", "RANGE", "TRANSITION"];

/** Same fee/slippage assumptions for every baseline strategy (spec section 8: "no permitir que una estrategia tenga ventaja artificial por utilizar diferentes condiciones de ejecución"). */
export const BASELINE_COST_MODEL = { feeBps: 10, slippageBps: 5 };
