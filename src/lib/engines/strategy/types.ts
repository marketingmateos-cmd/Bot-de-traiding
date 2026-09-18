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
  | "EVENT_DRIVEN"
  // Fase 17 — Signal Research Lab: new, structurally distinct hypothesis
  // families (spec section 4). Kept separate from the pre-existing kinds
  // above (never reused/renamed) so a research strategy's own label never
  // gets confused with an existing live-trading strategy's semantics.
  | "VOLATILITY_SQUEEZE"
  | "VOLUME_CONFIRMATION"
  | "TREND_PULLBACK"
  | "BREAKOUT_CONFIRMATION"
  | "MOMENTUM_REVERSAL"
  // Fase 20 — Nuevas Fuentes de Edge: only the 3 families formalized as
  // tradeable strategies (F20-B/C/E, spec Condición 5). F20-A stays a pure
  // statistical study and F20-D stays descriptive-only this phase (spec
  // Condiciones 4/6) — neither gets a StrategyKind.
  | "VOLATILITY_TRANSITION_SHOCK"
  | "VOLUME_PRICE_DIVERGENCE"
  | "COMPRESSION_DURATION";

export interface StrategyParams {
  [key: string]: number | string | boolean;
}

export interface StrategySignal {
  kind: StrategyKind;
  direction: "LONG" | "SHORT";
  strength: number; // 0-1
  reason: string;
  /**
   * Optional volatility-based stop/target as absolute PRICE levels
   * (Fase 11 — baseline research strategies). When present, the caller
   * (`historicalReplayEngine.ts`) uses these INSTEAD of the strategy's
   * fixed `defaultStopLossPct`/`defaultTakeProfitPct` — a strategy whose
   * risk genuinely varies bar-to-bar (e.g. ATR-based) is not forced into a
   * flat percentage. Every existing strategy leaves these undefined and is
   * completely unaffected.
   */
  stopLossPrice?: number;
  takeProfitPrice?: number;
  /** Free-form audit fields a strategy wants recorded verbatim (e.g. breakoutLevel, stopDistance, RRR) — never interpreted, only carried through to the decision/trade record for transparency. */
  meta?: Record<string, number | string>;
  /**
   * Optional position-size multiplier (> 0) the strategy wants applied to
   * its own next entry — DOWN for a consecutive-loss circuit breaker
   * scaling risk after a losing streak (e.g. 0.5, Candidata D v2), or UP
   * for a deliberately rare, high-conviction signal sizing more
   * aggressively than the normal per-trade risk (e.g. 2, Candidata E —
   * "few bets, sized bigger"). The caller multiplies its normal
   * `riskPerTradePct` by this factor before sizing. 1 (or omitted) means no
   * change; every existing strategy leaves this undefined and is
   * completely unaffected.
   */
  riskScaleFactor?: number;
}

export interface StrategyContext {
  higherTimeframeTrend?: number; // -1..1, from a longer timeframe's features.trend
  newsImpactScore?: number; // 0-100
  newsSentiment?: number; // -1..1
  /**
   * How many of this strategy's own most recent CLOSED trades, counting
   * back from the most recent, were losses in a row — 0 if the last trade
   * was a win or there are no closed trades yet. Engine-computed from real
   * trade history (`backtest.ts`/`historicalReplayEngine.ts`); `evaluate()`
   * has no other way to know its own past outcomes, since it is otherwise a
   * pure function of bars/features/params/regime. Only a strategy that
   * opts in reads this — every existing strategy ignores it.
   */
  consecutiveLosses?: number;
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
