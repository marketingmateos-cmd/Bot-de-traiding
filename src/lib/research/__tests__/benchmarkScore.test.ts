import { describe, expect, it } from "vitest";
import { computeBenchmarkScore } from "../benchmarkScore";
import type { ReplayMetrics } from "@/lib/replay/types";

function metrics(overrides: Partial<ReplayMetrics> = {}): ReplayMetrics {
  return {
    totalReturnPct: 0,
    cagrPct: null,
    sharpe: null,
    sortino: null,
    maxDrawdownPct: 0,
    winRate: 0,
    trades: 0,
    avgTradeReturnPct: 0,
    profitFactor: null,
    finalEquity: 20000,
    expectancy: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    exposurePct: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
    volatilityPct: 0,
    ...overrides,
  };
}

describe("Fase 11 — computeBenchmarkScore: never lets a huge return with extreme drawdown win automatically", () => {
  it("a strategy with a huge return but a huge drawdown and a FAILED evaluation scores LOW", () => {
    const result = computeBenchmarkScore(metrics({ totalReturnPct: 200, maxDrawdownPct: 60, winRate: 0.3, profitFactor: 1 }), "FAIL");
    expect(result.score).toBeLessThan(40);
  });

  it("a modest return with low drawdown, decent consistency, and a PASSED evaluation scores HIGH", () => {
    const result = computeBenchmarkScore(metrics({ totalReturnPct: 10, maxDrawdownPct: 5, winRate: 0.55, profitFactor: 1.8 }), "PASS");
    expect(result.score).toBeGreaterThan(70);
  });
});

describe("Fase 11 — computeBenchmarkScore: bounds and components", () => {
  it("score is always within [0, 100]", () => {
    const worst = computeBenchmarkScore(metrics({ totalReturnPct: -50, maxDrawdownPct: 100, winRate: 0, profitFactor: 0 }), "FAIL");
    const best = computeBenchmarkScore(metrics({ totalReturnPct: 500, maxDrawdownPct: 0, winRate: 1, profitFactor: 5 }), "PASS");
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(best.score).toBeLessThanOrEqual(100);
  });

  it("profitability component caps at a 20% return — 20% and 500% score identically on that component", () => {
    const cappedAt20 = computeBenchmarkScore(metrics({ totalReturnPct: 20 }), "INCONCLUSIVE");
    const wayOver = computeBenchmarkScore(metrics({ totalReturnPct: 500 }), "INCONCLUSIVE");
    expect(cappedAt20.profitabilityComponent).toBe(wayOver.profitabilityComponent);
  });

  it("evaluationSurvivalComponent matches PASS=100/INCONCLUSIVE=50/FAIL=0 exactly", () => {
    expect(computeBenchmarkScore(metrics(), "PASS").evaluationSurvivalComponent).toBe(100);
    expect(computeBenchmarkScore(metrics(), "INCONCLUSIVE").evaluationSurvivalComponent).toBe(50);
    expect(computeBenchmarkScore(metrics(), "FAIL").evaluationSurvivalComponent).toBe(0);
  });

  it("the formula string is always returned for transparency", () => {
    const result = computeBenchmarkScore(metrics(), "PASS");
    expect(result.formula).toContain("0.30");
    expect(result.formula.length).toBeGreaterThan(10);
  });
});
