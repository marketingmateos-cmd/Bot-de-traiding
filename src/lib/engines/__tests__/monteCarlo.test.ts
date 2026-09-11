import { describe, expect, it } from "vitest";
import { runMonteCarlo } from "../monteCarlo";
import type { BacktestTradeRecord } from "../backtest";

function trade(netPnl: number): BacktestTradeRecord {
  return {
    direction: "LONG",
    entryTime: new Date().toISOString(),
    exitTime: new Date().toISOString(),
    entryPrice: 100,
    exitPrice: 100 + netPnl,
    quantity: 1,
    fees: 0,
    netPnl,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 0,
  };
}

describe("runMonteCarlo", () => {
  it("is deterministic for a fixed seed", () => {
    const trades = [trade(5), trade(-3), trade(2), trade(-1)];
    const a = runMonteCarlo(trades, 100, { iterations: 200, seed: 42 });
    const b = runMonteCarlo(trades, 100, { iterations: 200, seed: 42 });
    expect(a).toEqual(b);
  });

  it("produces different distributions for different seeds", () => {
    const trades = [trade(5), trade(-3), trade(2), trade(-1), trade(4), trade(-6)];
    const a = runMonteCarlo(trades, 100, { iterations: 500, seed: 1 });
    const b = runMonteCarlo(trades, 100, { iterations: 500, seed: 2 });
    expect(a.finalReturnPct.median).not.toBe(b.finalReturnPct.median);
  });

  it("reports 100% probability of ruin when every trade is a huge loss", () => {
    const trades = [trade(-90), trade(-90), trade(-90)];
    const result = runMonteCarlo(trades, 100, { iterations: 100, ruinThresholdPct: 50 });
    expect(result.probabilityOfRuin).toBe(1);
  });

  it("reports 0% probability of ruin when every trade is profitable", () => {
    const trades = [trade(5), trade(3), trade(8)];
    const result = runMonteCarlo(trades, 100, { iterations: 100 });
    expect(result.probabilityOfRuin).toBe(0);
    expect(result.probabilityOfLoss).toBe(0);
  });

  it("handles an empty trade list without throwing", () => {
    const result = runMonteCarlo([], 100);
    expect(result.iterations).toBe(0);
    expect(result.probabilityOfRuin).toBe(0);
  });
});
