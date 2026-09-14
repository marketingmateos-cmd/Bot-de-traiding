import { describe, expect, it } from "vitest";
import { bucketTradesBySession, computeSessionDescriptiveStats } from "../phase20SessionAnalysis";
import { F20D_SESSIONS } from "../phase20PreRegistration";
import type { ReplayTradeRecord } from "@/lib/replay/types";

function trade(entryHourUtc: number, netPnl: number, overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  const entryTime = new Date(Date.UTC(2026, 0, 1, entryHourUtc)).toISOString();
  return {
    asset: "BTC",
    strategyId: "s",
    strategyName: "S",
    direction: "LONG",
    entryTime,
    exitTime: new Date(Date.UTC(2026, 0, 1, entryHourUtc + 1)).toISOString(),
    entryPrice: 100,
    exitPrice: netPnl >= 0 ? 105 : 95,
    quantity: 1,
    fees: 1,
    slippageCost: 0.5,
    grossPnl: netPnl,
    netPnl,
    exitReason: netPnl >= 0 ? "TAKE_PROFIT" : "STOP_LOSS",
    mae: 0,
    mfe: 0,
    decisionIndex: 0,
    stopLoss: 95,
    takeProfit: 105,
    ...overrides,
  };
}

describe("bucketTradesBySession", () => {
  it("puts a pure-ASIA-hour trade only in ASIA", () => {
    const buckets = bucketTradesBySession([trade(3, 10)], F20D_SESSIONS);
    expect(buckets.ASIA).toHaveLength(1);
    expect(buckets.LONDON).toHaveLength(0);
    expect(buckets.NY).toHaveLength(0);
  });

  it("puts a LONDON/NY overlap-hour trade in BOTH buckets", () => {
    const buckets = bucketTradesBySession([trade(14, 10)], F20D_SESSIONS);
    expect(buckets.LONDON).toHaveLength(1);
    expect(buckets.NY).toHaveLength(1);
    expect(buckets.ASIA).toHaveLength(0);
  });

  it("buckets by ENTRY time, never exit time", () => {
    // Entry in ASIA (hour 2), but exits (per the trade() helper) at hour 3 — still ASIA either way here,
    // so use an entry/exit pair straddling a session boundary explicitly.
    const t = trade(7, 10, { exitTime: new Date(Date.UTC(2026, 0, 1, 14)).toISOString() }); // entry hour 7 = ASIA, exit hour 14 = LONDON/NY
    const buckets = bucketTradesBySession([t], F20D_SESSIONS);
    expect(buckets.ASIA).toHaveLength(1);
    expect(buckets.LONDON).toHaveLength(0);
    expect(buckets.NY).toHaveLength(0);
  });
});

describe("computeSessionDescriptiveStats", () => {
  it("flags insufficientSample when a bucket has fewer than MIN_SAMPLE_SIZE(20) trades", () => {
    const trades = [trade(3, 10), trade(4, -5)];
    const stats = computeSessionDescriptiveStats(trades, F20D_SESSIONS);
    const asia = stats.find((s) => s.session === "ASIA")!;
    expect(asia.tradeCount).toBe(2);
    expect(asia.insufficientSample).toBe(true);
  });

  it("computes winRate/totalNetPnl/avgNetPnl correctly for a sufficient sample", () => {
    const trades = Array.from({ length: 25 }, (_, i) => trade(2, i % 2 === 0 ? 10 : -5));
    const stats = computeSessionDescriptiveStats(trades, F20D_SESSIONS);
    const asia = stats.find((s) => s.session === "ASIA")!;
    expect(asia.tradeCount).toBe(25);
    expect(asia.insufficientSample).toBe(false);
    expect(asia.winRate).toBeCloseTo(13 / 25, 5);
    const expectedTotal = 13 * 10 + 12 * -5;
    expect(asia.totalNetPnl).toBeCloseTo(expectedTotal, 5);
    expect(asia.avgNetPnl).toBeCloseTo(expectedTotal / 25, 5);
  });

  it("returns null winRate/avgNetPnl/avgR/medianR for an empty bucket, never NaN or 0-by-default", () => {
    const stats = computeSessionDescriptiveStats([], F20D_SESSIONS);
    for (const s of stats) {
      expect(s.tradeCount).toBe(0);
      expect(s.winRate).toBeNull();
      expect(s.avgNetPnl).toBeNull();
      expect(s.avgR).toBeNull();
      expect(s.medianR).toBeNull();
    }
  });

  it("returns exactly the 3 frozen sessions, in order, never a 4th bucket", () => {
    const stats = computeSessionDescriptiveStats([trade(3, 10)], F20D_SESSIONS);
    expect(stats.map((s) => s.session)).toEqual(["ASIA", "LONDON", "NY"]);
  });
});
