import type { DataQualityReport } from "./dataQuality";
import type { Regime, RegimeResult } from "./regime";
import { isRegimeCompatible } from "./regime";
import type { StrategySignal } from "./strategy/types";
import type { NewsSummary } from "./news";
import type { SentimentAnalysis } from "./sentiment";
import type { OnChainMetricResult } from "@/lib/providers/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";
import type { RiskCheckResult } from "./riskEngine";
import type { LuckVsEdgeAssessment } from "./luckVsEdge";

export type GateVerdict = "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED";

export interface GateStep {
  name:
    | "DATA_CHECK"
    | "MARKET_CHECK"
    | "REGIME_CHECK"
    | "STRATEGY_CHECK"
    | "NEWS_CHECK"
    | "SENTIMENT_CHECK"
    | "ONCHAIN_CHECK"
    | "AI_ANALYST"
    | "AI_CRITIC"
    | "RISK_CHECK"
    | "ROBUSTNESS_CHECK";
  passed: boolean;
  downgrade: boolean; // true = doesn't block outright but forces LOW_CONFIDENCE
  detail: string;
}

export interface TradeGateInput {
  dataQuality: DataQualityReport;
  marketHealthy: boolean; // e.g. latest price reachable
  regime: RegimeResult;
  /** The strategy VERSION's own declared recommended regimes — the single source of truth for regime gating. */
  recommendedRegimes: Regime[];
  strategySignal: StrategySignal | null;
  news: NewsSummary;
  sentiment: SentimentAnalysis;
  onChain: OnChainMetricResult[];
  aiAnalyst: AIAnalystOutput;
  aiCritic: AICriticOutput;
  risk: RiskCheckResult;
  circuitBreakerTripped: boolean;
  circuitBreakerReasons: string[];
  robustness: LuckVsEdgeAssessment;
}

export interface TradeGateResult {
  verdict: GateVerdict;
  blockedBy: string | null;
  steps: GateStep[];
}

/**
 * Trade Gate (spec §18) — the ONLY path from "a strategy has an idea" to "a
 * simulated order is placed". Runs all 11 checks every time (never
 * short-circuits) so the full audit trail is always available, then derives
 * a verdict: any failed non-downgrade step BLOCKS; any downgrade-only issue
 * caps the verdict at LOW_CONFIDENCE.
 */
export function runTradeGate(input: TradeGateInput): TradeGateResult {
  const steps: GateStep[] = [];

  steps.push({
    name: "DATA_CHECK",
    passed: !input.dataQuality.blocksTrading,
    downgrade: false,
    detail: input.dataQuality.blocksTrading
      ? `Data quality score ${input.dataQuality.score} is below the minimum required to trade.`
      : `Data quality score ${input.dataQuality.score}/100.`,
  });

  steps.push({
    name: "MARKET_CHECK",
    passed: input.marketHealthy,
    downgrade: false,
    detail: input.marketHealthy ? "Market data feed is healthy." : "Market data feed is unreachable or stale.",
  });

  const regimeOk = isRegimeCompatible(input.recommendedRegimes, input.regime.regime);
  steps.push({
    name: "REGIME_CHECK",
    passed: regimeOk,
    downgrade: false,
    detail: regimeOk
      ? `Regime ${input.regime.regime} is compatible with this strategy version's recommended regimes.`
      : `Regime ${input.regime.regime} is NOT in this strategy version's recommended regimes (${input.recommendedRegimes.join(", ")}).`,
  });

  const hasSignal = input.strategySignal !== null;
  steps.push({
    name: "STRATEGY_CHECK",
    passed: hasSignal,
    downgrade: false,
    detail: hasSignal ? `Strategy produced a ${input.strategySignal!.direction} signal: ${input.strategySignal!.reason}` : "No strategy signal present.",
  });

  const newsBlocking = input.news.topStories.some((n) => n.category === "SECURITY" && n.sentiment < -0.6 && n.impactScore > 70);
  steps.push({
    name: "NEWS_CHECK",
    passed: !newsBlocking,
    downgrade: !newsBlocking && input.news.score < 35,
    detail: newsBlocking
      ? "A high-impact, strongly negative security-related news item was found."
      : `News component score ${input.news.score}/100.`,
  });

  steps.push({
    name: "SENTIMENT_CHECK",
    passed: true,
    downgrade: input.sentiment.divergence,
    detail: input.sentiment.divergence
      ? "Sentiment/price divergence detected — confidence downgraded."
      : `Sentiment score ${input.sentiment.score}/100, trend ${input.sentiment.trend.toFixed(3)}.`,
  });

  const onChainAvailable = input.onChain.filter((m) => m.available).length;
  steps.push({
    name: "ONCHAIN_CHECK",
    passed: true,
    downgrade: onChainAvailable === 0,
    detail: onChainAvailable > 0 ? `${onChainAvailable} on-chain metric(s) available.` : "No on-chain data available for this asset — DATA UNAVAILABLE.",
  });

  const analystOk = input.aiAnalyst.recommendation !== "REJECT";
  steps.push({
    name: "AI_ANALYST",
    passed: analystOk,
    downgrade: input.aiAnalyst.recommendation === "LOW_CONFIDENCE",
    detail: `AI Analyst recommends ${input.aiAnalyst.recommendation} (confidence ${(input.aiAnalyst.confidence * 100).toFixed(0)}%).`,
  });

  const criticOk = input.aiCritic.verdict !== "BLOCKED";
  steps.push({
    name: "AI_CRITIC",
    passed: criticOk,
    downgrade: input.aiCritic.verdict === "LOW_CONFIDENCE",
    detail: `AI Critic verdict: ${input.aiCritic.verdict}.${input.aiCritic.challengedReasons.length ? " Challenges: " + input.aiCritic.challengedReasons.join("; ") : ""}`,
  });

  const riskOk = input.risk.passed && !input.circuitBreakerTripped;
  steps.push({
    name: "RISK_CHECK",
    passed: riskOk,
    downgrade: false,
    detail: input.circuitBreakerTripped
      ? `Circuit breaker(s) tripped: ${input.circuitBreakerReasons.join(", ")}`
      : input.risk.passed
      ? `Projected exposure ${input.risk.exposurePctAfter.toFixed(1)}% within limits.`
      : input.risk.violations.join(" "),
  });

  steps.push({
    name: "ROBUSTNESS_CHECK",
    // Never an outright block: a brand-new strategy version has zero trades
    // by definition, and it has to be allowed to trade cautiously (as
    // LOW_CONFIDENCE) to ever accumulate the evidence this check wants —
    // otherwise no strategy could ever bootstrap real performance history.
    passed: true,
    downgrade: input.robustness.evidenceLevel === "LOW",
    detail: `Evidence level: ${input.robustness.evidenceLevel}. ${input.robustness.warnings.join(" ")}`,
  });

  const failedStep = steps.find((s) => !s.passed);
  const downgradeStep = steps.find((s) => s.downgrade);

  let verdict: GateVerdict = "APPROVED";
  let blockedBy: string | null = null;
  if (failedStep) {
    verdict = "BLOCKED";
    blockedBy = failedStep.name;
  } else if (downgradeStep) {
    verdict = "LOW_CONFIDENCE";
    blockedBy = downgradeStep.name;
  }

  return { verdict, blockedBy, steps };
}
