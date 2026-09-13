import { describe, expect, it } from "vitest";
import { computeEvidenceQuality } from "../evidenceQuality";
import type { ReplayDataQualityReport, ReplayMetrics } from "../types";

function goodDataQuality(): ReplayDataQualityReport {
  return { coveragePct: 99, missingCandlesPct: 0, duplicateTimestamps: 0, invalidCandles: 0, futureLeakage: 0, chronologyViolations: 0, totalBarsExpected: 1000, totalBarsPresent: 990, blocksReplay: false, warnings: [] };
}

function metricsWithTrades(trades: number): ReplayMetrics {
  return {
    totalReturnPct: 5,
    cagrPct: 10,
    sharpe: 1.2,
    sortino: 1.5,
    maxDrawdownPct: 8,
    winRate: 0.55,
    trades,
    avgTradeReturnPct: 0.3,
    profitFactor: 1.8,
    finalEquity: 10500,
    expectancy: 12,
    avgWinPct: 2,
    avgLossPct: -1,
    exposurePct: 40,
    longestWinStreak: 4,
    longestLossStreak: 2,
    volatilityPct: 15,
    };
}

describe("AUDIT: Evidence Quality never depends on profitability alone (Fase 8)", () => {
  it("returns INSUFFICIENT_EVIDENCE when the sample is too small, regardless of a great-looking return", () => {
    const report = computeEvidenceQuality({
      dataQuality: goodDataQuality(),
      metrics: metricsWithTrades(5), // tiny sample, but totalReturnPct is a flashy +5%
      decisions: [],
      robustness: null,
      robustnessScore: null,
      overfitting: null,
      hasOos: false,
      oosTrades: 0,
    });
    expect(report.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("returns INSUFFICIENT_EVIDENCE when data coverage is too low even with many trades", () => {
    const badCoverage: ReplayDataQualityReport = { ...goodDataQuality(), coveragePct: 20 };
    const report = computeEvidenceQuality({
      dataQuality: badCoverage,
      metrics: metricsWithTrades(150),
      decisions: [],
      robustness: "ROBUST",
      robustnessScore: 90,
      overfitting: { risk: "LOW", score: 5, flags: [] },
      hasOos: true,
      oosTrades: 40,
    });
    expect(report.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("caps at LOW when overfitting risk is HIGH, even with a large sample and full data coverage", () => {
    const report = computeEvidenceQuality({
      dataQuality: goodDataQuality(),
      metrics: metricsWithTrades(200),
      decisions: [],
      robustness: "MODERATE",
      robustnessScore: 50,
      overfitting: { risk: "HIGH", score: 80, flags: ["too many degrees of freedom"] },
      hasOos: true,
      oosTrades: 50,
    });
    expect(report.verdict).toBe("LOW");
  });

  it("caps at LOW when there is no OOS segment at all, no matter how good everything else looks", () => {
    const report = computeEvidenceQuality({
      dataQuality: goodDataQuality(),
      metrics: metricsWithTrades(200),
      decisions: [],
      robustness: "ROBUST",
      robustnessScore: 95,
      overfitting: { risk: "LOW", score: 5, flags: [] },
      hasOos: false,
      oosTrades: 0,
    });
    expect(report.verdict).toBe("LOW");
  });

  it("only reaches HIGH with a large sample, ROBUST classification, low overfitting risk, and a real OOS segment", () => {
    const report = computeEvidenceQuality({
      dataQuality: goodDataQuality(),
      metrics: metricsWithTrades(150),
      decisions: [],
      robustness: "ROBUST",
      robustnessScore: 85,
      overfitting: { risk: "LOW", score: 5, flags: [] },
      hasOos: true,
      oosTrades: 40,
    });
    expect(report.verdict).toBe("HIGH");
  });

  it("lands at MEDIUM for a decent-but-not-exceptional run (enough trades, some OOS, but MODERATE robustness)", () => {
    const report = computeEvidenceQuality({
      dataQuality: goodDataQuality(),
      metrics: metricsWithTrades(60),
      decisions: [],
      robustness: "MODERATE",
      robustnessScore: 55,
      overfitting: { risk: "LOW", score: 10, flags: [] },
      hasOos: true,
      oosTrades: 35,
    });
    expect(report.verdict).toBe("MEDIUM");
  });
});
