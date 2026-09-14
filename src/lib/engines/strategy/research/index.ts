import { volatilitySqueezeStrategy } from "./volatilitySqueeze";
import { volumeConfirmationStrategy } from "./volumeConfirmation";
import { trendPullbackStrategy } from "./trendPullback";
import { breakoutConfirmationStrategy } from "./breakoutConfirmation";
import { momentumReversalStrategy } from "./momentumReversal";
import type { StrategyDefinition } from "../types";

/**
 * Fase 17 — Signal Research Lab: 5 new, structurally distinct hypothesis
 * families (spec section 4/5). Mirrors `../baseline/index.ts`'s own
 * pattern exactly — deliberately NOT part of `STRATEGY_REGISTRY` (never
 * runs in live Paper Trading or "Bot completo" replay), resolved only via
 * `getStrategyById`'s fallback, same as the Fase 11 baselines.
 */
export const RESEARCH_STRATEGY_REGISTRY: StrategyDefinition[] = [
  volatilitySqueezeStrategy,
  volumeConfirmationStrategy,
  trendPullbackStrategy,
  breakoutConfirmationStrategy,
  momentumReversalStrategy,
];

export { volatilitySqueezeStrategy, volumeConfirmationStrategy, trendPullbackStrategy, breakoutConfirmationStrategy, momentumReversalStrategy };
export { HYPOTHESIS_REGISTRY, getHypothesis, type StrategyHypothesis } from "./hypothesisRegistry";
