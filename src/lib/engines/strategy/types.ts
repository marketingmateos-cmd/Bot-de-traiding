import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";
import type { FeatureSnapshot } from "../features";
import type { Regime } from "../regime";

export type StrategyKind =
  | "TREND_FOLLOWING"
  | "MOMENTUM"
  | "BREAKOUT"
  | "MEAN_REVERSION"
  | "VOLATILITY"
  | "MULTI_TIMEFRAME"
  | "EVENT_DRIVEN";

export interface StrategyParams {
  [key: string]: number | string | boolean;
}

export interface StrategySignal {
  kind: StrategyKind;
  direction: "LONG" | "SHORT";
  strength: number; // 0-1
  reason: string;
}

export interface StrategyContext {
  higherTimeframeTrend?: number; // -1..1, from a longer timeframe's features.trend
  newsImpactScore?: number; // 0-100
  newsSentiment?: number; // -1..1
}

export interface StrategyDefinition {
  id: string;
  kind: StrategyKind;
  name: string;
  version: string;
  defaultParams: StrategyParams;
  timeframe: TimeframeCode;
  recommendedRegimes: Regime[];
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  defaultTrailingStopPct: number | null;
  costModel: { feeBps: number; slippageBps: number };
  /**
   * Evaluate the strategy against the latest bar window + features. Returns
   * null when no signal fires (most bars, most of the time — this is not
   * supposed to always have an opinion).
   */
  evaluate(
    bars: OHLCVBar[],
    features: FeatureSnapshot,
    params: StrategyParams,
    regime: Regime,
    context?: StrategyContext
  ): StrategySignal | null;
}
