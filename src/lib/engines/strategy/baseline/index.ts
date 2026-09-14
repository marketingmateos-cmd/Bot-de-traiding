import { breakoutBaselineStrategy } from "./breakoutBaseline";
import { momentumBaselineStrategy } from "./momentumBaseline";
import { meanReversionBaselineStrategy } from "./meanReversionBaseline";
import { trendFollowingBaselineStrategy } from "./trendFollowingBaseline";
import type { StrategyDefinition } from "../types";

/**
 * Fase 11 — the four research baseline strategies (spec sections 4-7).
 * Deliberately NOT part of `STRATEGY_REGISTRY` (see strategy/index.ts's doc
 * comment) — these exist for the Strategy Research & Evaluation Benchmark
 * only, resolved via `getStrategyById`'s fallback.
 */
export const BASELINE_STRATEGY_REGISTRY: StrategyDefinition[] = [
  breakoutBaselineStrategy,
  momentumBaselineStrategy,
  meanReversionBaselineStrategy,
  trendFollowingBaselineStrategy,
];

export { breakoutBaselineStrategy, momentumBaselineStrategy, meanReversionBaselineStrategy, trendFollowingBaselineStrategy };
