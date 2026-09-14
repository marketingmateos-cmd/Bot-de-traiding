import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE_SIZE,
  attachRegimeToTrades,
  computeBucketStats,
  computeExitAnalysis,
  computeLossAnalysis,
  computeRegimeAnalysis,
  computeStrategyRegimeMatrix,
  computeVolatilityBucket,
} from "../regimeAnalysis";
import type { ReplayDecisionRecord, ReplayTradeRecord } from "@/lib/replay/types";

function decision(overrides: Partial<ReplayDecisionRecord> = {}): ReplayDecisionRecord {
  return {
    timestamp: "2026-03-01T00:00:00.000Z",
    asset: "BTC",
    availability: { marketData: "REAL", news: "REAL", sentiment: "REAL", onChain: "REAL", ai: "DETERMINISTIC_SYNTHETIC" },
    regime: "BULL",
    volatilityPercentile: 50,
    strategyId: "breakout-baseline-v1",
    strategyName: "Breakout Baseline",
    signal: { direction: "LONG", strength: 0.6, reason: "test" },
    aiAnalyst: null,
    aiCritic: null,
    tradeGateVerdict: "APPROVED",
    tradeGateBlockedBy: null,
    tradeGateSteps: null,
    riskPassed: true,
    riskViolations: null,
    evidenceLevel: null,
    decision: "OPENED",
    positionSize: 0.1,
    entryPrice: 100,
    reason: "test",
    ...overrides,
  };
}

function trade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "breakout-baseline-v1",
    strategyName: "Breakout Baseline",
    direction: "LONG",
    entryTime: "2026-03-01T00:00:00.000Z",
    exitTime: "2026-03-01T04:00:00.000Z",
    entryPrice: 100,
    exitPrice: 103,
    quantity: 1,
    fees: 0.1,
    slippageCost: 0.05,
    grossPnl: 3,
    netPnl: 2.85,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 3,
    decisionIndex: 0,
    stopLoss: 98,
    takeProfit: 103,
    ...overrides,
  };
}

describe("Fase 12 — computeVolatilityBucket: simple, documented terciles", () => {
  it("below 25 -> LOW, above 75 -> HIGH, else NORMAL, null/undefined -> UNKNOWN", () => {
    expect(computeVolatilityBucket(10)).toBe("LOW");
    expect(computeVolatilityBucket(24.9)).toBe("LOW");
    expect(computeVolatilityBucket(25)).toBe("NORMAL");
    expect(computeVolatilityBucket(50)).toBe("NORMAL");
    expect(computeVolatilityBucket(75)).toBe("NORMAL");
    expect(computeVolatilityBucket(75.1)).toBe("HIGH");
    expect(computeVolatilityBucket(95)).toBe("HIGH");
    expect(computeVolatilityBucket(null)).toBe("UNKNOWN");
    expect(computeVolatilityBucket(undefined)).toBe("UNKNOWN");
  });
});

describe("Fase 12 — attachRegimeToTrades: regime timestamp <= signal timestamp, no future leakage", () => {
  it("a trade's regime comes EXACTLY from the decision at its own decisionIndex, never a later one", () => {
    const decisions = [
      decision({ timestamp: "2026-03-01T00:00:00.000Z", regime: "BULL", volatilityPercentile: 20 }),
      decision({ timestamp: "2026-03-02T00:00:00.000Z", regime: "BEAR", volatilityPercentile: 80 }), // this is the OPENING decision for the trade below
      decision({ timestamp: "2026-03-05T00:00:00.000Z", regime: "STRONG_BULL", volatilityPercentile: 95 }), // a LATER decision — must never leak into the trade
    ];
    const trades = [trade({ entryTime: "2026-03-02T00:00:00.000Z", decisionIndex: 1 })];

    const [enriched] = attachRegimeToTrades(trades, decisions);
    expect(enriched.regime).toBe("BEAR"); // from decisionIndex 1, not the earlier or later one
    expect(enriched.volatilityBucket).toBe("HIGH"); // 80 -> HIGH
    expect(new Date(decisions[1].timestamp).getTime()).toBeLessThanOrEqual(new Date(trades[0].entryTime).getTime());
  });

  it("never attaches a decision that occurs chronologically AFTER the trade's own entryTime, even if it exists later in the array", () => {
    // The opening decision (index 0) is BEFORE entry; index 1 (a later decision in time) must never be used.
    const decisions = [
      decision({ timestamp: "2026-03-01T00:00:00.000Z", regime: "RANGE" }),
      decision({ timestamp: "2026-03-10T00:00:00.000Z", regime: "STRONG_BEAR" }),
    ];
    const trades = [trade({ entryTime: "2026-03-01T00:00:00.000Z", decisionIndex: 0 })];
    const [enriched] = attachRegimeToTrades(trades, decisions);
    expect(enriched.regime).toBe("RANGE");
    expect(enriched.regime).not.toBe("STRONG_BEAR");
  });

  it("handles an out-of-range decisionIndex honestly (regime: null), never throws", () => {
    const [enriched] = attachRegimeToTrades([trade({ decisionIndex: 99 })], [decision()]);
    expect(enriched.regime).toBeNull();
    expect(enriched.volatilityBucket).toBe("UNKNOWN");
  });
});

describe("Fase 12 — correct regime attribution across multiple trades/strategies", () => {
  it("each trade gets its OWN decision's regime, not a shared/default one", () => {
    const decisions = [decision({ regime: "BULL" }), decision({ regime: "RANGE" }), decision({ regime: "HIGH_VOLATILITY" })];
    const trades = [trade({ decisionIndex: 0 }), trade({ decisionIndex: 1 }), trade({ decisionIndex: 2 })];
    const enriched = attachRegimeToTrades(trades, decisions);
    expect(enriched.map((e) => e.regime)).toEqual(["BULL", "RANGE", "HIGH_VOLATILITY"]);
  });
});

describe("Fase 12 — long/short classification", () => {
  it("direction is read straight from the trade record", () => {
    const [long, short] = attachRegimeToTrades([trade({ direction: "LONG", decisionIndex: 0 }), trade({ direction: "SHORT", decisionIndex: 0 })], [decision()]);
    expect(long.direction).toBe("LONG");
    expect(short.direction).toBe("SHORT");
  });

  it("computeRegimeAnalysis splits stats cleanly by direction", () => {
    const decisions = [decision()];
    const trades = [
      trade({ direction: "LONG", netPnl: 10, decisionIndex: 0 }),
      trade({ direction: "LONG", netPnl: -5, decisionIndex: 0 }),
      trade({ direction: "SHORT", netPnl: 20, decisionIndex: 0 }),
    ];
    const analysis = computeRegimeAnalysis(trades, decisions);
    expect(analysis.byDirection.LONG.trades).toBe(2);
    expect(analysis.byDirection.SHORT.trades).toBe(1);
    expect(analysis.byDirection.SHORT.totalPnl).toBe(20);
  });
});

describe("Fase 12 — R-multiple computation", () => {
  it("rMultiple = netPnl / (|entryPrice - stopLoss| * quantity)", () => {
    const [enriched] = attachRegimeToTrades([trade({ entryPrice: 100, stopLoss: 95, quantity: 2, netPnl: 20, decisionIndex: 0 })], [decision()]);
    // riskAmount = |100-95|*2 = 10; rMultiple = 20/10 = 2
    expect(enriched.rMultiple).toBeCloseTo(2, 5);
  });

  it("rMultiple is null when stopLoss is missing (a trade predating Fase 11's per-trade capture)", () => {
    const [enriched] = attachRegimeToTrades([trade({ stopLoss: undefined, decisionIndex: 0 })], [decision()]);
    expect(enriched.rMultiple).toBeNull();
  });
});

describe("Fase 12 — computeBucketStats: insufficient sample handling", () => {
  it("flags insufficientSample when trades < MIN_SAMPLE_SIZE", () => {
    const decisions = [decision()];
    const enriched = attachRegimeToTrades(
      Array.from({ length: MIN_SAMPLE_SIZE - 1 }, () => trade({ decisionIndex: 0 })),
      decisions
    );
    const stats = computeBucketStats(enriched);
    expect(stats.trades).toBe(MIN_SAMPLE_SIZE - 1);
    expect(stats.insufficientSample).toBe(true);
  });

  it("does NOT flag insufficientSample at exactly MIN_SAMPLE_SIZE trades", () => {
    const decisions = [decision()];
    const enriched = attachRegimeToTrades(
      Array.from({ length: MIN_SAMPLE_SIZE }, () => trade({ decisionIndex: 0 })),
      decisions
    );
    const stats = computeBucketStats(enriched);
    expect(stats.insufficientSample).toBe(false);
  });

  it("still computes real stats even when insufficientSample is true — never omits them", () => {
    const decisions = [decision()];
    const enriched = attachRegimeToTrades([trade({ netPnl: 10, decisionIndex: 0 }), trade({ netPnl: -4, decisionIndex: 0 })], decisions);
    const stats = computeBucketStats(enriched);
    expect(stats.insufficientSample).toBe(true);
    expect(stats.totalPnl).toBe(6);
    expect(stats.winRate).toBe(0.5);
  });
});

describe("Fase 12 — loss analysis", () => {
  it("largestLosses are sorted most-negative first, capped at 10", () => {
    const decisions = [decision()];
    const trades = [
      trade({ netPnl: -50, decisionIndex: 0, entryTime: "2026-03-01T00:00:00Z", exitTime: "2026-03-01T01:00:00Z" }),
      trade({ netPnl: -10, decisionIndex: 0, entryTime: "2026-03-02T00:00:00Z", exitTime: "2026-03-02T01:00:00Z" }),
      trade({ netPnl: -200, decisionIndex: 0, entryTime: "2026-03-03T00:00:00Z", exitTime: "2026-03-03T01:00:00Z" }),
      trade({ netPnl: 5, decisionIndex: 0, entryTime: "2026-03-04T00:00:00Z", exitTime: "2026-03-04T01:00:00Z" }),
    ];
    const enriched = attachRegimeToTrades(trades, decisions);
    const loss = computeLossAnalysis(enriched);
    expect(loss.largestLosses.map((l) => l.netPnl)).toEqual([-200, -50, -10]);
  });

  it("computes a losing-streak distribution across chronological trades", () => {
    const decisions = [decision()];
    // W L L W L L L W  -> losing streaks of length 2, then 3
    const netPnls = [5, -1, -1, 5, -1, -1, -1, 5];
    const trades = netPnls.map((pnl, i) =>
      trade({ netPnl: pnl, decisionIndex: 0, entryTime: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`, exitTime: `2026-03-${String(i + 1).padStart(2, "0")}T01:00:00Z` })
    );
    const enriched = attachRegimeToTrades(trades, decisions);
    const loss = computeLossAnalysis(enriched);
    expect(loss.losingStreakDistribution[2]).toBe(1);
    expect(loss.losingStreakDistribution[3]).toBe(1);
    expect(loss.maxLosingStreak).toBe(3);
  });

  it("avgRMultiple/medianRMultiple ignore trades with a null rMultiple", () => {
    const decisions = [decision()];
    const trades = [
      trade({ entryPrice: 100, stopLoss: 90, quantity: 1, netPnl: 20, decisionIndex: 0 }), // R = 2
      trade({ entryPrice: 100, stopLoss: 90, quantity: 1, netPnl: -10, decisionIndex: 0 }), // R = -1
      trade({ stopLoss: undefined, decisionIndex: 0 }), // R = null, excluded
    ];
    const enriched = attachRegimeToTrades(trades, decisions);
    const loss = computeLossAnalysis(enriched);
    expect(loss.avgRMultiple).toBeCloseTo(0.5, 5); // (2 + -1) / 2
  });
});

describe("Fase 12 — exit analysis", () => {
  it("groups by exitReason with count/totalPnl/avgPnl, and cross-tabs by regime", () => {
    const decisions = [decision({ regime: "BULL" }), decision({ regime: "BEAR" })];
    const trades = [
      trade({ exitReason: "STOP_LOSS", netPnl: -10, decisionIndex: 0 }),
      trade({ exitReason: "STOP_LOSS", netPnl: -20, decisionIndex: 1 }),
      trade({ exitReason: "TAKE_PROFIT", netPnl: 30, decisionIndex: 0 }),
    ];
    const enriched = attachRegimeToTrades(trades, decisions);
    const exit = computeExitAnalysis(enriched);
    expect(exit.byExitReason.STOP_LOSS.count).toBe(2);
    expect(exit.byExitReason.STOP_LOSS.totalPnl).toBe(-30);
    expect(exit.byExitReason.STOP_LOSS.avgPnl).toBe(-15);
    expect(exit.byExitReasonAndRegime.STOP_LOSS.BULL).toBe(1);
    expect(exit.byExitReasonAndRegime.STOP_LOSS.BEAR).toBe(1);
  });
});

describe("Fase 12 — Strategy × Regime matrix", () => {
  it("produces one cell per (strategy, regime) combination actually observed, flagging thin cells", () => {
    const decisionsA = [decision({ regime: "BULL" })];
    const decisionsB = [decision({ regime: "RANGE" })];
    const matrix = computeStrategyRegimeMatrix([
      { strategyId: "breakout-baseline-v1", strategyName: "Breakout", trades: [trade({ decisionIndex: 0, netPnl: 10 })], decisions: decisionsA },
      { strategyId: "momentum-baseline-v1", strategyName: "Momentum", trades: [trade({ decisionIndex: 0, netPnl: -5 })], decisions: decisionsB },
    ]);
    expect(matrix).toHaveLength(2);
    const breakoutCell = matrix.find((c) => c.strategyId === "breakout-baseline-v1")!;
    expect(breakoutCell.regime).toBe("BULL");
    expect(breakoutCell.trades).toBe(1);
    expect(breakoutCell.insufficientSample).toBe(true); // 1 trade << MIN_SAMPLE_SIZE
  });
});

describe("Fase 12 — deterministic results", () => {
  it("the exact same input produces byte-identical output across two calls", () => {
    const decisions = [decision({ regime: "BULL", volatilityPercentile: 40 }), decision({ regime: "RANGE", volatilityPercentile: 60 })];
    const trades = [trade({ decisionIndex: 0, netPnl: 12 }), trade({ decisionIndex: 1, netPnl: -8 })];
    const a = computeRegimeAnalysis(trades, decisions);
    const b = computeRegimeAnalysis(trades, decisions);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
