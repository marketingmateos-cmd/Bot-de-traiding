import { trendFollowingStrategy } from "./trendFollowing";
import { momentumStrategy } from "./momentum";
import { breakoutStrategy } from "./breakout";
import { meanReversionStrategy } from "./meanReversion";
import { volatilityStrategy } from "./volatility";
import { multiTimeframeStrategy } from "./multiTimeframe";
import { eventDrivenStrategy } from "./eventDriven";
import { BASELINE_STRATEGY_REGISTRY } from "./baseline";
import { RESEARCH_STRATEGY_REGISTRY } from "./research";
import type { StrategyDefinition } from "./types";

export const STRATEGY_REGISTRY: StrategyDefinition[] = [
  trendFollowingStrategy,
  momentumStrategy,
  breakoutStrategy,
  meanReversionStrategy,
  volatilityStrategy,
  multiTimeframeStrategy,
  eventDrivenStrategy,
];

/**
 * Fase 11 — `STRATEGY_REGISTRY` itself is deliberately left untouched: it is
 * what "Bot completo" replays (`config.strategyId === null`) run, and what
 * `/replay`'s general strategy picker lists — adding the research baseline
 * strategies there would silently change both. `getStrategyById()` alone
 * gets a fallback so `HistoricalReplayEngine` (looked up by a single
 * `config.strategyId`) can still resolve a baseline strategy by id when the
 * Strategy Lab benchmark asks for one explicitly.
 */
export function getStrategyById(id: string): StrategyDefinition | undefined {
  return STRATEGY_REGISTRY.find((s) => s.id === id) ?? BASELINE_STRATEGY_REGISTRY.find((s) => s.id === id) ?? RESEARCH_STRATEGY_REGISTRY.find((s) => s.id === id);
}

export { BASELINE_STRATEGY_REGISTRY } from "./baseline";
export { RESEARCH_STRATEGY_REGISTRY, HYPOTHESIS_REGISTRY, getHypothesis, type StrategyHypothesis } from "./research";
export * from "./types";
