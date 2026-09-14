import type { OHLCVBar, TimeframeCode, AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";
import type { Regime } from "@/lib/engines/regime";
import type { EvidenceLevel } from "@/lib/engines/luckVsEdge";
import type { GateStep, GateVerdict } from "@/lib/engines/tradeGate";
import type { BacktestMetrics } from "@/lib/engines/backtest";
import type { StrategyParams } from "@/lib/engines/strategy/types";

/**
 * Historical Replay (Fase 7) — shared types.
 *
 * REGLA ABSOLUTA (see historicalReplayEngine.ts's own doc comment for the
 * full list): this module and everything under src/lib/replay/ describes a
 * simulation that is structurally isolated from live Paper Trading. Nothing
 * here ever reads or writes PaperAccount/PaperPosition/Trade/BotConfig — see
 * ReplayPortfolio.
 */

/** Where the replay's market/news/sentiment/on-chain data actually comes from — never left implicit. */
export type ReplayDataSource = "SYNTHETIC" | "HISTORICAL_REAL";

/**
 * How the AI layer participates in a replay (Fase 7B):
 *  - FULL_HISTORICAL: only uses a REAL AIAnalysis row already recorded by
 *    the live system at (or very near) that historical timestamp. If none
 *    exists, the candidate is marked data-unavailable and skipped — never
 *    fabricated.
 *  - DETERMINISTIC_AI: always the rule-based DemoAIProvider, a pure
 *    function of its input with zero randomness — reproducible, but
 *    explicitly NOT a real historical conversation with a model.
 *  - AI_ASSISTED: calls whatever AI provider is currently configured
 *    (demo or a real Anthropic call) live, during the replay — an
 *    experimental "what would today's AI say about this old data" probe,
 *    never presented as historical evidence.
 */
export type ReplayAiMode = "FULL_HISTORICAL" | "DETERMINISTIC_AI" | "AI_ASSISTED";

export type ReplaySegmentLabel = "FULL" | "IS" | "VALIDATION" | "OOS" | string;

export interface ReplayConfig {
  assetSymbols: string[];
  timeframe: TimeframeCode;
  startDate: Date;
  endDate: Date;
  /** null = "Bot completo" (every strategy in the registry); otherwise one strategy id. */
  strategyId: string | null;
  aiMode: ReplayAiMode;
  dataSource: ReplayDataSource;
  initialCapital: number;
  riskLevel: number;
  feeBpsOverride?: number;
  slippageBpsOverride?: number;
  /** Fase 7G — parameter-perturbation robustness testing overrides the strategy's own defaultParams with this, when set. */
  strategyParamsOverride?: StrategyParams;
  /** Fase 14 — the `ResearchDataset` this run is reproducing, when the caller picked a registered dataset instead of typing raw dates. Purely a reproducibility annotation (spec section 11: "registrar datasetId y datasetHash") — never changes what bars are fetched; `startDate`/`endDate` above still drive that exactly as before. `executeReplay()` persists this id (and the dataset's own hash at registration time) onto the resulting `ReplayRun` row. */
  datasetId?: string;
}

/** One data source's real-vs-synthetic-vs-unavailable status for a single decision point — never silently blended. */
export interface ReplayDataAvailability {
  marketData: "REAL" | "SYNTHETIC" | "UNAVAILABLE";
  news: "REAL" | "SYNTHETIC" | "UNAVAILABLE";
  sentiment: "REAL" | "SYNTHETIC" | "UNAVAILABLE";
  onChain: "REAL" | "SYNTHETIC" | "UNAVAILABLE";
  ai: "REAL_HISTORICAL" | "DETERMINISTIC_SYNTHETIC" | "EXPERIMENTAL_LIVE" | "UNAVAILABLE";
}

/**
 * One evaluated candidate, full audit trail — this is what the UI's
 * "WHY DID THE BOT ENTER?" screen renders. Only created when a strategy
 * actually produced a signal (mirrors runPaperTradingScan's own
 * results.push behavior) — every bar tick that produced NO signal is not
 * logged here, to keep a months-long replay's decision log a reasonable size.
 */
export interface ReplayDecisionRecord {
  timestamp: string; // ISO
  asset: string;
  availability: ReplayDataAvailability;
  regime: Regime | null;
  /** Fase 12 — the SAME `detectRegime()` call's `details.volatilityPercentile` (0-100, trailing-history percentile), persisted so a discrete volatility bucket can be derived at analysis time without re-running the (already causal, already-computed) Regime Engine. Undefined for any decision predating this field. */
  volatilityPercentile?: number | null;
  strategyId: string;
  strategyName: string;
  signal: { direction: "LONG" | "SHORT"; strength: number; reason: string } | null;
  aiAnalyst: AIAnalystOutput | null;
  aiCritic: AICriticOutput | null;
  tradeGateVerdict: GateVerdict | null;
  tradeGateBlockedBy: string | null;
  tradeGateSteps: GateStep[] | null;
  riskPassed: boolean | null;
  riskViolations: string[] | null;
  evidenceLevel: EvidenceLevel | null;
  decision: "OPENED" | "SKIPPED_NO_SIGNAL" | "SKIPPED_NO_HISTORICAL_DATA" | "BLOCKED" | "REDUCED_SIZE";
  positionSize: number | null;
  entryPrice: number | null;
  reason: string;
}

export interface ReplayTradeRecord {
  asset: string;
  strategyId: string;
  strategyName: string;
  direction: "LONG" | "SHORT";
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  fees: number;
  slippageCost: number;
  grossPnl: number;
  netPnl: number;
  exitReason: string;
  mae: number;
  mfe: number;
  decisionIndex: number; // index into the run's decisions[] that opened this trade
  /** The stop/target PRICE levels this position was actually opened with — undefined for a run predating this field, never backfilled. Fase 11: lets a strategy's real per-trade RRR be derived (|takeProfit-entry| / |entry-stopLoss|) instead of assumed constant. */
  stopLoss?: number | null;
  takeProfit?: number | null;
}

/** Superset of BacktestMetrics (same field names/types) so existing benchmark/robustness/overfitting engines accept it unchanged. */
export interface ReplayMetrics extends BacktestMetrics {
  expectancy: number; // average € per trade
  avgWinPct: number;
  avgLossPct: number;
  exposurePct: number; // % of the run's duration with at least one position open
  longestWinStreak: number;
  longestLossStreak: number;
  volatilityPct: number;
  /** Fase 11 — dollar-notional exposure (openNotional / equity), distinct from `exposurePct`'s time-in-market %. Optional: undefined for any caller of computeReplayMetrics that doesn't supply it (none does today besides historicalReplayEngine.ts, which always does). */
  maxExposurePct?: number;
  avgExposurePct?: number;
}

export interface ReplayDataQualityReport {
  coveragePct: number;
  missingCandlesPct: number;
  duplicateTimestamps: number;
  invalidCandles: number;
  futureLeakage: number;
  chronologyViolations: number;
  totalBarsExpected: number;
  totalBarsPresent: number;
  blocksReplay: boolean;
  warnings: string[];
}

export interface ReplaySegmentResult {
  label: ReplaySegmentLabel;
  startDate: string;
  endDate: string;
  equityCurve: { t: number; equity: number }[];
  drawdownCurve: { t: number; drawdownPct: number }[];
  trades: ReplayTradeRecord[];
  decisions: ReplayDecisionRecord[];
  metrics: ReplayMetrics;
}

export type EvidenceQualityVerdict = "INSUFFICIENT_EVIDENCE" | "LOW" | "MEDIUM" | "HIGH";

export interface EvidenceQualityReport {
  verdict: EvidenceQualityVerdict;
  dataQuality: number; // 0-100
  sampleSize: number; // trades
  historicalCoveragePct: number;
  aiAvailabilityPct: number; // % of decisions with real/deterministic AI (not unavailable)
  oosQualityScore: number | null; // 0-100, null if no OOS segment run
  robustnessScore: number | null;
  overfittingRisk: "LOW" | "MEDIUM" | "HIGH" | null;
  factors: string[];
}
