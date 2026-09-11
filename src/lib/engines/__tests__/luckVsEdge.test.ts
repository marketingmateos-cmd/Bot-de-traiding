import { describe, expect, it } from "vitest";
import { assessEvidence } from "../luckVsEdge";

describe("assessEvidence — Luck vs Edge", () => {
  it("never rates a strategy with few trades above LOW evidence, however good its win rate looks", () => {
    const result = assessEvidence({ trades: 5, winRate: 1, avgReturnPct: 10, sharpe: 5, sortino: 5, maxDrawdownPct: 1, totalNetPnl: 50, profitFactor: 10 });
    expect(result.evidenceLevel).toBe("LOW");
    expect(result.sampleSizeOk).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("flags a high win rate on a small sample as likely luck, not edge", () => {
    const result = assessEvidence({ trades: 40, winRate: 0.85, avgReturnPct: 1, sharpe: 1, sortino: 1, maxDrawdownPct: 5, totalNetPnl: 20, profitFactor: 3 });
    expect(result.warnings.some((w) => w.toLowerCase().includes("racha de suerte"))).toBe(true);
  });

  it("requires both a large sample AND few warnings to reach HIGH evidence", () => {
    const result = assessEvidence(
      { trades: 150, winRate: 0.55, avgReturnPct: 0.6, sharpe: 1.3, sortino: 1.6, maxDrawdownPct: 10, totalNetPnl: 60, profitFactor: 1.8 },
      { robustnessScore: 70, oosMetrics: { sharpe: 0.8 }, benchmarkBeat: true }
    );
    expect(result.evidenceLevel).toBe("HIGH");
  });

  it("never reaches ROBUST verdict without robustness testing or a benchmark beat", () => {
    const result = assessEvidence({ trades: 200, winRate: 0.6, avgReturnPct: 0.8, sharpe: 2, sortino: 2, maxDrawdownPct: 5, totalNetPnl: 100, profitFactor: 2.5 });
    expect(result.verdict).not.toBe("ROBUST");
  });

  it("flags underperformance against Buy & Hold explicitly", () => {
    const result = assessEvidence(
      { trades: 100, winRate: 0.5, avgReturnPct: 0.2, sharpe: 0.8, sortino: 0.8, maxDrawdownPct: 15, totalNetPnl: 10, profitFactor: 1.1 },
      { benchmarkBeat: false }
    );
    expect(result.warnings.some((w) => w.toLowerCase().includes("buy & hold"))).toBe(true); // "Buy & Hold" se mantiene en inglés como término técnico
  });

  it("flags severe drawdown even alongside a positive headline return", () => {
    const result = assessEvidence({ trades: 100, winRate: 0.6, avgReturnPct: 2, sharpe: 1, sortino: 1, maxDrawdownPct: 40, totalNetPnl: 200, profitFactor: 2 });
    expect(result.warnings.some((w) => w.includes("drawdown"))).toBe(true);
  });
});
