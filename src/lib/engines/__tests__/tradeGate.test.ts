import { describe, expect, it } from "vitest";
import { runTradeGate, type TradeGateInput } from "../tradeGate";
import { assessEvidence } from "../luckVsEdge";
import type { OnChainMetricResult } from "@/lib/providers/types";

const availableOnChain: OnChainMetricResult[] = [
  { symbol: "BTC", metric: "exchange_inflow", timestamp: new Date(), value: 1000, available: true },
  { symbol: "BTC", metric: "active_addresses", timestamp: new Date(), value: 500000, available: true },
];

function baseInput(overrides: Partial<TradeGateInput> = {}): TradeGateInput {
  return {
    dataQuality: { score: 90, issues: [], blocksTrading: false },
    marketHealthy: true,
    regime: { regime: "BULL", confidence: 0.7, details: { trendSlopePct: 1, volatilityPercentile: 50, rangeWidthPct: 5 } },
    recommendedRegimes: ["STRONG_BULL", "BULL", "STRONG_BEAR", "BEAR"],
    strategySignal: { kind: "TREND_FOLLOWING", direction: "LONG", strength: 0.8, reason: "test" },
    news: { score: 60, topStories: [], clusterCount: 0, totalArticles: 0 },
    sentiment: { current: 0.2, trend: 0.01, acceleration: 0, divergence: false, divergenceMagnitude: 0, score: 60 },
    onChain: availableOnChain,
    aiAnalyst: { signal: "LONG", confidence: 0.7, reasons: [], risks: [], invalidation_conditions: [], data_quality: 80, recommendation: "APPROVE" },
    aiCritic: { verdict: "APPROVED", challengedReasons: [], biasesFound: [], overfittingConcern: false, notes: "" },
    risk: { passed: true, violations: [], violationKinds: [], exposurePctAfter: 10 },
    circuitBreakerTripped: false,
    circuitBreakerReasons: [],
    robustness: assessEvidence({ trades: 0, winRate: 0, avgReturnPct: 0, sharpe: null, sortino: null, maxDrawdownPct: 0, totalNetPnl: 0, profitFactor: null }),
    ...overrides,
  };
}

const goodEvidence = assessEvidence(
  { trades: 150, winRate: 0.55, avgReturnPct: 0.5, sharpe: 1.2, sortino: 1.5, maxDrawdownPct: 8, totalNetPnl: 50, profitFactor: 1.8 },
  { robustnessScore: 70, oosMetrics: { sharpe: 0.8 }, benchmarkBeat: true }
);

describe("runTradeGate", () => {
  it("regression: a brand-new strategy with zero historical trades is NOT deadlocked — it downgrades to LOW_CONFIDENCE, never BLOCKED, at the robustness step alone", () => {
    const result = runTradeGate(baseInput());
    const robustnessStep = result.steps.find((s) => s.name === "ROBUSTNESS_CHECK")!;
    expect(robustnessStep.passed).toBe(true);
    expect(robustnessStep.downgrade).toBe(true);
    expect(result.verdict).toBe("LOW_CONFIDENCE");
  });

  it("approves when every check is clean and evidence is sufficient", () => {
    const result = runTradeGate(baseInput({ robustness: goodEvidence }));
    expect(result.verdict).toBe("APPROVED");
    expect(result.blockedBy).toBeNull();
  });

  it("blocks outright when data quality is too low", () => {
    const result = runTradeGate(baseInput({ dataQuality: { score: 20, issues: [], blocksTrading: true }, robustness: goodEvidence }));
    expect(result.verdict).toBe("BLOCKED");
    expect(result.blockedBy).toBe("DATA_CHECK");
  });

  it("blocks outright when a circuit breaker is tripped", () => {
    const result = runTradeGate(baseInput({ circuitBreakerTripped: true, circuitBreakerReasons: ["max-drawdown"], robustness: goodEvidence }));
    expect(result.verdict).toBe("BLOCKED");
    expect(result.blockedBy).toBe("RISK_CHECK");
  });

  it("blocks outright when the regime is not in this strategy version's recommended regimes", () => {
    const result = runTradeGate(
      baseInput({
        recommendedRegimes: ["RANGE", "NEUTRAL", "LOW_VOLATILITY"],
        regime: { regime: "STRONG_BULL", confidence: 0.9, details: { trendSlopePct: 5, volatilityPercentile: 50, rangeWidthPct: 20 } },
        robustness: goodEvidence,
      })
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.blockedBy).toBe("REGIME_CHECK");
  });

  it("blocks outright when the AI Critic verdict is BLOCKED", () => {
    const result = runTradeGate(
      baseInput({ aiCritic: { verdict: "BLOCKED", challengedReasons: ["bad idea"], biasesFound: [], overfittingConcern: true, notes: "" }, robustness: goodEvidence })
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.blockedBy).toBe("AI_CRITIC");
  });

  it("downgrades (never blocks) on sentiment/price divergence alone", () => {
    const result = runTradeGate(
      baseInput({
        sentiment: { current: 0.2, trend: 0.01, acceleration: 0, divergence: true, divergenceMagnitude: 0.5, score: 60 },
        robustness: goodEvidence,
      })
    );
    expect(result.verdict).toBe("LOW_CONFIDENCE");
    const sentimentStep = result.steps.find((s) => s.name === "SENTIMENT_CHECK")!;
    expect(sentimentStep.downgrade).toBe(true);
  });

  it("downgrades (never blocks) when no on-chain data is available", () => {
    const result = runTradeGate(baseInput({ onChain: [], robustness: goodEvidence }));
    expect(result.verdict).toBe("LOW_CONFIDENCE");
    const onChainStep = result.steps.find((s) => s.name === "ONCHAIN_CHECK")!;
    expect(onChainStep.downgrade).toBe(true);
  });

  it("always runs all 11 checks regardless of earlier failures (full audit trail)", () => {
    const result = runTradeGate(baseInput({ dataQuality: { score: 10, issues: [], blocksTrading: true }, circuitBreakerTripped: true }));
    expect(result.steps).toHaveLength(11);
  });
});
