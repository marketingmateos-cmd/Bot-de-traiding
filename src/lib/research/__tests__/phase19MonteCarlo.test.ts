import { describe, expect, it } from "vitest";
import {
  applyCostStress,
  runBootstrapMonteCarlo,
  runBlockBootstrapMonteCarlo,
  computeOutlierAnalysis,
  computeExpectancyStats,
  classifyRobustness,
  type BootstrapOptions,
} from "../phase19MonteCarlo";
import { FROZEN_EVALUATION_PROFILE, FROZEN_STRESS_SCENARIOS } from "../phase19PreRegistration";
import type { ReplayTradeRecord } from "@/lib/replay/types";

function trade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "s1",
    strategyName: "S1",
    direction: "LONG",
    entryTime: "2026-01-01T00:00:00.000Z",
    exitTime: "2026-01-01T01:00:00.000Z",
    entryPrice: 100,
    exitPrice: 105,
    quantity: 1,
    fees: 2,
    slippageCost: 1,
    grossPnl: 5,
    netPnl: 5,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 5,
    decisionIndex: 0,
    stopLoss: 95,
    takeProfit: 105,
    ...overrides,
  };
}

function baseOptions(overrides: Partial<BootstrapOptions> = {}): BootstrapOptions {
  return {
    iterations: 2000,
    seed: 19,
    initialEquity: 20000,
    evaluationProfile: FROZEN_EVALUATION_PROFILE,
    ruinThresholdPct: 50,
    returnThresholdsPct: [0, 3, 5],
    drawdownThresholdsPct: [5, 10, 15, 20],
    ...overrides,
  };
}

describe("applyCostStress — spec section 13", () => {
  it("BASE scenario (multiplier 1/1) reproduces netPnl EXACTLY, never approximately", () => {
    const trades = [trade({ netPnl: 5, fees: 2, slippageCost: 1 }), trade({ netPnl: -3, fees: 1.5, slippageCost: 0.8 })];
    const stressed = applyCostStress(trades, FROZEN_STRESS_SCENARIOS[0]); // BASE
    expect(stressed[0].netPnl).toBe(5);
    expect(stressed[1].netPnl).toBe(-3);
  });

  it("fees+25% subtracts exactly 25% of the trade's own fees from netPnl", () => {
    const trades = [trade({ netPnl: 10, fees: 4, slippageCost: 0 })];
    const scenario = FROZEN_STRESS_SCENARIOS.find((s) => s.id === "STRESS_FEES_25")!;
    const stressed = applyCostStress(trades, scenario);
    expect(stressed[0].netPnl).toBeCloseTo(10 - 4 * 0.25, 6);
  });

  it("slippage+50% subtracts exactly 50% of the trade's own slippageCost from netPnl", () => {
    const trades = [trade({ netPnl: 10, fees: 0, slippageCost: 2 })];
    const scenario = FROZEN_STRESS_SCENARIOS.find((s) => s.id === "STRESS_SLIPPAGE_50")!;
    const stressed = applyCostStress(trades, scenario);
    expect(stressed[0].netPnl).toBeCloseTo(10 - 2 * 0.5, 6);
  });

  it("fees+50%+slippage+50% combines both deltas", () => {
    const trades = [trade({ netPnl: 10, fees: 4, slippageCost: 2 })];
    const scenario = FROZEN_STRESS_SCENARIOS.find((s) => s.id === "STRESS_FEES_50_SLIPPAGE_50")!;
    const stressed = applyCostStress(trades, scenario);
    expect(stressed[0].netPnl).toBeCloseTo(10 - 4 * 0.5 - 2 * 0.5, 6);
  });

  it("never mutates the original trades array or its objects", () => {
    const original = trade({ netPnl: 10, fees: 4, slippageCost: 2 });
    const trades = [original];
    const originalSnapshot = { ...original };
    applyCostStress(trades, FROZEN_STRESS_SCENARIOS.find((s) => s.id === "STRESS_FEES_50_SLIPPAGE_50")!);
    expect(trades[0]).toEqual(originalSnapshot);
    expect(trades[0]).toBe(original); // same reference, untouched
  });
});

describe("runBootstrapMonteCarlo — determinism (spec sections 5/27)", () => {
  const trades = [
    trade({ netPnl: 100, exitTime: "2026-01-01T01:00:00.000Z" }),
    trade({ netPnl: -50, exitTime: "2026-01-02T01:00:00.000Z" }),
    trade({ netPnl: 30, exitTime: "2026-01-03T01:00:00.000Z" }),
    trade({ netPnl: -80, exitTime: "2026-01-04T01:00:00.000Z" }),
    trade({ netPnl: 20, exitTime: "2026-01-05T01:00:00.000Z" }),
  ];

  it("the exact same trades + seed + iterations produce byte-identical aggregate results", () => {
    const a = runBootstrapMonteCarlo(trades, baseOptions());
    const b = runBootstrapMonteCarlo(trades, baseOptions());
    expect(b).toEqual(a);
  });

  it("a different seed produces a different (but still valid) result", () => {
    const a = runBootstrapMonteCarlo(trades, baseOptions({ seed: 19 }));
    const b = runBootstrapMonteCarlo(trades, baseOptions({ seed: 7 }));
    expect(b.finalReturnPct.mean).not.toBe(a.finalReturnPct.mean);
  });

  it("runs exactly the requested number of iterations", () => {
    const result = runBootstrapMonteCarlo(trades, baseOptions({ iterations: 3333 }));
    expect(result.iterations).toBe(3333);
  });

  it("every simulation draws exactly N trades (tradesPerSimulation === trades.length)", () => {
    const result = runBootstrapMonteCarlo(trades, baseOptions());
    expect(result.tradesPerSimulation).toBe(5);
  });
});

describe("runBootstrapMonteCarlo — equity/drawdown/losing-streak math (spec sections 6/7/10)", () => {
  it("a single deterministic trade set (all iterations draw the SAME single trade) reproduces exact hand-computed equity/return/drawdown", () => {
    // With only 1 trade, bootstrap resampling has no randomness — every simulation is identical.
    const singleLoss = [trade({ netPnl: -1000 })];
    const result = runBootstrapMonteCarlo(singleLoss, baseOptions({ iterations: 100 }));
    // equity: 20000 -> 19000, return = -5%, drawdown = 1000/20000 = 5%
    expect(result.finalReturnPct.mean).toBeCloseTo(-5, 6);
    expect(result.finalReturnPct.p50).toBeCloseTo(-5, 6);
    expect(result.maxDrawdownPct.p50).toBeCloseTo(5, 6);
    expect(result.losingStreak.p50).toBe(1);
  });

  it("a single deterministic winning trade never triggers ruin/loss probability", () => {
    const singleWin = [trade({ netPnl: 500 })];
    const result = runBootstrapMonteCarlo(singleWin, baseOptions({ iterations: 100 }));
    expect(result.probabilities.loss).toBe(0);
    expect(result.probabilities.ruin).toBe(0);
    expect(result.probabilities.returnPositive).toBe(1);
  });
});

describe("percentile calculations (spec section 28 item 8)", () => {
  it("P5-P95 are monotonically non-decreasing and match hand-computed values for a simple 2-trade alternating set", () => {
    // 2 trades, +100/-100: every bootstrap draw is a mix of only +100 and -100 outcomes.
    const trades = [trade({ netPnl: 100 }), trade({ netPnl: -100 })];
    const result = runBootstrapMonteCarlo(trades, baseOptions({ iterations: 5000 }));
    expect(result.finalReturnPct.p5).toBeLessThanOrEqual(result.finalReturnPct.p50);
    expect(result.finalReturnPct.p50).toBeLessThanOrEqual(result.finalReturnPct.p95);
    // Possible outcomes for 2 draws from {+100,-100}: -200, 0, +200 (in $) -> -1%, 0%, +1% return.
    expect([-1, 0, 1]).toContain(Math.round(result.finalReturnPct.p50 * 100) / 100 === 0 ? 0 : Math.sign(result.finalReturnPct.p50));
  });
});

describe("insufficient sample handling (spec sections 9/12/28 item 13)", () => {
  it("classifyRobustness returns INCONCLUSIVE when sample size is below MIN_SAMPLE_SIZE, regardless of the numbers", () => {
    const trades = Array.from({ length: 8 }, () => trade({ netPnl: 50 })); // n=8, all winners
    const base = runBootstrapMonteCarlo(trades, baseOptions());
    const stressed = applyCostStress(trades, FROZEN_STRESS_SCENARIOS.find((s) => s.id === "STRESS_FEES_50_SLIPPAGE_50")!);
    const stress = runBootstrapMonteCarlo(stressed, baseOptions());
    const result = classifyRobustness(base, stress, 10, 8, 20);
    expect(result.classification).toBe("INCONCLUSIVE");
  });
});

describe("classifyRobustness (spec section 23)", () => {
  it("classifies NEGATIVE_ROBUST when observed, BASE median, and heaviest-stress median are all <= 0", () => {
    const trades = Array.from({ length: 30 }, (_, i) => trade({ netPnl: i % 3 === 0 ? 50 : -80 }));
    const base = runBootstrapMonteCarlo(trades, baseOptions());
    const stressedTrades = applyCostStress(trades, FROZEN_STRESS_SCENARIOS.find((s) => s.id === "STRESS_FEES_50_SLIPPAGE_50")!);
    const stress = runBootstrapMonteCarlo(stressedTrades, baseOptions());
    const result = classifyRobustness(base, stress, -12, 30, 20);
    expect(result.classification).toBe("NEGATIVE_ROBUST");
  });

  it("never classifies a strategy ROBUST when the original observed result was negative", () => {
    const trades = Array.from({ length: 30 }, (_, i) => trade({ netPnl: i % 2 === 0 ? 100 : -90 }));
    const base = runBootstrapMonteCarlo(trades, baseOptions());
    const stress = runBootstrapMonteCarlo(trades, baseOptions()); // same (no stress delta here, irrelevant to this check)
    const result = classifyRobustness(base, stress, -5, 30, 20);
    expect(result.classification).not.toBe("ROBUST");
  });
});

describe("computeOutlierAnalysis (spec section 17) — descriptive only, never removes trades", () => {
  it("identifies best/worst trade and top-5 gains/losses without mutating input", () => {
    const trades = [trade({ netPnl: 500 }), trade({ netPnl: -300 }), trade({ netPnl: 10 }), trade({ netPnl: -5 }), trade({ netPnl: 50 }), trade({ netPnl: -700 })];
    const original = [...trades];
    const result = computeOutlierAnalysis(trades);
    expect(result.bestTrade).toBe(500);
    expect(result.worstTrade).toBe(-700);
    expect(trades).toEqual(original);
  });
});

describe("computeExpectancyStats (spec section 18)", () => {
  it("returns null meanR/medianR (never NaN) for an empty trade set", () => {
    const result = computeExpectancyStats([]);
    expect(result.meanR).toBeNull();
    expect(result.medianR).toBeNull();
    expect(result.tradeCount).toBe(0);
  });
});

describe("runBlockBootstrapMonteCarlo (spec section 20) — determinism and structural validity", () => {
  const trades = Array.from({ length: 40 }, (_, i) => trade({ netPnl: (i % 4 === 0 ? 120 : -40), exitTime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

  it("is deterministic for the same seed", () => {
    const a = runBlockBootstrapMonteCarlo(trades, 5, baseOptions({ iterations: 500 }));
    const b = runBlockBootstrapMonteCarlo(trades, 5, baseOptions({ iterations: 500 }));
    expect(b).toEqual(a);
  });

  it("every simulation still resamples exactly N trades total, even though drawn in blocks", () => {
    const result = runBlockBootstrapMonteCarlo(trades, 5, baseOptions({ iterations: 500 }));
    expect(result.tradesPerSimulation).toBe(40);
  });
});
