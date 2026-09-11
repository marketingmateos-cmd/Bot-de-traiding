import { trendFollowingStrategy } from "./trendFollowing";
import { momentumStrategy } from "./momentum";
import { breakoutStrategy } from "./breakout";
import { meanReversionStrategy } from "./meanReversion";
import { volatilityStrategy } from "./volatility";
import { multiTimeframeStrategy } from "./multiTimeframe";
import { eventDrivenStrategy } from "./eventDriven";
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

export function getStrategyById(id: string): StrategyDefinition | undefined {
  return STRATEGY_REGISTRY.find((s) => s.id === id);
}

export * from "./types";
