import { volatilityTransitionShockStrategy } from "./volatilityTransitionShock";
import { volumeDivergenceStrategy } from "./volumeDivergence";
import { compressionDurationStrategy } from "./compressionDuration";
import type { StrategyDefinition } from "../types";

/**
 * Fase 20 — Nuevas Fuentes de Edge: exactly the 3 families formalized as
 * `StrategyDefinition` (F20-B/C/E, spec Condición 5 — F20-A stays a pure
 * statistical study, F20-D stays descriptive-only). Mirrors
 * `../research/index.ts`'s own pattern exactly — deliberately NOT part of
 * `STRATEGY_REGISTRY` (never runs in live Paper Trading or "Bot completo"
 * replay), resolved only via `getStrategyById`'s fallback, same as the
 * Fase 11 baselines and Fase 17 research strategies.
 */
export const RESEARCH20_STRATEGY_REGISTRY: StrategyDefinition[] = [volatilityTransitionShockStrategy, volumeDivergenceStrategy, compressionDurationStrategy];

export { volatilityTransitionShockStrategy, volumeDivergenceStrategy, compressionDurationStrategy };
