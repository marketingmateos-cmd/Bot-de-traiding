import { resolveEvaluationTemplate } from "@/lib/evaluation/evaluationRiskEngine";
import { FROZEN_DATASET } from "./phase18PreRegistration";

/**
 * Fase 19 — Robustness, Monte Carlo & Stress Testing, spec sections 2/5/13/26.
 * Everything below is frozen BEFORE running any simulation: the seed,
 * iteration count, stress scenarios, and — critically — the exact source
 * of trades (the 9 `ReplayRun` ids Fase 18 already produced and persisted).
 * This phase re-runs NO strategy and re-fetches NO market data; it only
 * resamples trades that already exist.
 */

export { FROZEN_DATASET };

/** Section 5 — >= 10,000 simulations per strategy/segment, deterministic seed. Frozen here, never re-tuned after seeing results. */
export const FROZEN_MONTE_CARLO_CONFIG = { seed: 19, iterations: 10_000 };

/** Section 16's ruin threshold, reused from the existing (Fase 4) Monte Carlo module's own convention (50% of starting equity) — never redefined per strategy. */
export const RUIN_THRESHOLD_PCT = 50;

/** Section 16 — final-return and max-drawdown thresholds this phase reports probabilities for. Fixed, never chosen after seeing a strategy's own numbers. */
export const RETURN_THRESHOLDS_PCT = [0, 3, 5] as const;
export const DRAWDOWN_THRESHOLDS_PCT = [5, 10, 15, 20] as const;

export interface StressScenario {
  id: string;
  label: string;
  feeMultiplier: number;
  slippageMultiplier: number;
}

/** Spec section 13 — the exact 6 scenarios (BASE + 5 stress), fixed order, never extended to search for a favorable one. */
export const FROZEN_STRESS_SCENARIOS: StressScenario[] = [
  { id: "BASE", label: "Costes actuales (sin stress)", feeMultiplier: 1, slippageMultiplier: 1 },
  { id: "STRESS_FEES_25", label: "Fees +25%", feeMultiplier: 1.25, slippageMultiplier: 1 },
  { id: "STRESS_FEES_50", label: "Fees +50%", feeMultiplier: 1.5, slippageMultiplier: 1 },
  { id: "STRESS_SLIPPAGE_25", label: "Slippage +25%", feeMultiplier: 1, slippageMultiplier: 1.25 },
  { id: "STRESS_SLIPPAGE_50", label: "Slippage +50%", feeMultiplier: 1, slippageMultiplier: 1.5 },
  { id: "STRESS_FEES_50_SLIPPAGE_50", label: "Fees +50% + Slippage +50%", feeMultiplier: 1.5, slippageMultiplier: 1.5 },
];

/** Section 9/16 — same €20K / Phase 1 / Risk Level 5 evaluation profile Fase 11/17/18 already used, reused UNCHANGED (`resolveEvaluationTemplate` is Fase 11's own, never modified here). */
export const FROZEN_EVALUATION_PROFILE = { ...resolveEvaluationTemplate("20K"), phase: "PHASE_1" as const, resetHourUtc: 0 };
export const FROZEN_RISK_LEVEL = 5;

/**
 * Spec section 3/26 — the exact source of trades: the `ReplayRun` id each
 * of the 9 strategies' Fase 18 IS/VALIDATION/OOS replay produced,
 * documented verbatim in the Fase 18 final report (Section 17). No
 * strategy is re-executed to obtain these — this phase only reads the
 * `ReplayResult` rows those runs already persisted.
 */
export const FROZEN_PHASE18_REPLAY_RUN_IDS: Record<string, string> = {
  "breakout-baseline-v1": "cmu1e7w1p001v70340lkkmen4",
  "momentum-baseline-v1": "cmu1e9sr400227034e886g0i3",
  "mean-reversion-baseline-v1": "cmu1eb5g7003970341tpngia0",
  "trend-following-baseline-v1": "cmu1edh1w003s70342c5xbvjw",
  "research-volatility-squeeze-v1": "cmu1efjvq003z7034fky2dmsn",
  "research-volume-confirmation-v1": "cmu1ehpp4004i7034l5z0etni",
  "research-trend-pullback-v1": "cmu1eiqbm004w7034ommu51k9",
  "research-breakout-confirmation-v1": "cmu1ekqhi005f7034vp4i47xt",
  "research-momentum-reversal-v1": "cmu1en421006m7034m8m2booe",
};

export const FROZEN_STRATEGY_IDS = Object.keys(FROZEN_PHASE18_REPLAY_RUN_IDS);

export type SegmentLabel = "IS" | "VALIDATION" | "OOS";
export const SEGMENT_LABELS: SegmentLabel[] = ["IS", "VALIDATION", "OOS"];

/** Section 9's sample-size floor, reused from Fase 12 (`MIN_SAMPLE_SIZE`) via `regimeAnalysis.ts` — kept as one named constant here too so every Fase 19 module agrees on the same number without importing across phases inconsistently. */
export const MIN_SAMPLE_SIZE = 20;

/** Spec section 20 — block bootstrap is only attempted when a segment has at least this many trades (enough to form >= 8 non-degenerate blocks at the frozen block size below). Below this floor, block bootstrap is explicitly marked NOT IMPLEMENTED with a stated reason, never silently skipped. */
export const MIN_TRADES_FOR_BLOCK_BOOTSTRAP = 40;
export const FROZEN_BLOCK_SIZE = 5;
