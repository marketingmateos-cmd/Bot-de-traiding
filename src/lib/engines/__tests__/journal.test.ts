import { describe, expect, it } from "vitest";
import {
  bestWorstDays,
  bestWorstTrade,
  computeDailyStats,
  computeDayOfWeekStats,
  computeDrawdownWithDuration,
  computeStreaks,
  groupPerformance,
  type JournalTradeLike,
} from "../journal";

function trade(overrides: Partial<JournalTradeLike> & { closedAt: Date; netPnl: number }): JournalTradeLike {
  return {
    id: Math.random().toString(36),
    openedAt: overrides.closedAt,
    entryPrice: 100,
    quantity: 1,
    direction: "LONG",
    exitReason: "TAKE_PROFIT",
    assetSymbol: "BTC",
    assetClass: "CRYPTO",
    strategyName: "Trend Following",
    strategyVersionId: "sv1",
    ...overrides,
  };
}

describe("computeDailyStats", () => {
  it("walks starting/ending balance day by day from the account's starting balance", () => {
    const day1 = new Date("2026-01-01T10:00:00Z");
    const day2 = new Date("2026-01-02T10:00:00Z");
    const trades = [
      trade({ closedAt: day1, netPnl: 5 }),
      trade({ closedAt: day1, netPnl: -2 }),
      trade({ closedAt: day2, netPnl: 3 }),
    ];
    const daily = computeDailyStats(trades, 100);
    expect(daily).toHaveLength(2);
    expect(daily[0].date).toBe("2026-01-01");
    expect(daily[0].startingBalance).toBe(100);
    expect(daily[0].endingBalance).toBe(103);
    expect(daily[0].pnl).toBe(3);
    expect(daily[0].trades).toBe(2);
    expect(daily[0].wins).toBe(1);
    expect(daily[0].losses).toBe(1);
    // day 2 starts where day 1 ended
    expect(daily[1].startingBalance).toBe(103);
    expect(daily[1].endingBalance).toBe(106);
  });

  it("returns an empty array for no trades rather than a fabricated zero day", () => {
    expect(computeDailyStats([], 100)).toEqual([]);
  });

  it("computes profit factor correctly for a mixed day", () => {
    const day = new Date("2026-01-01T00:00:00Z");
    const daily = computeDailyStats(
      [trade({ closedAt: day, netPnl: 10 }), trade({ closedAt: day, netPnl: -5 })],
      100
    );
    expect(daily[0].profitFactor).toBeCloseTo(2, 6); // 10 gross profit / 5 gross loss
  });
});

describe("computeStreaks", () => {
  it("tracks the current streak and the best/worst historical streaks", () => {
    const trades = [{ netPnl: 1 }, { netPnl: 1 }, { netPnl: -1 }, { netPnl: -1 }, { netPnl: -1 }, { netPnl: 1 }, { netPnl: 1 }, { netPnl: 1 }];
    const streaks = computeStreaks(trades);
    expect(streaks.bestWinStreak).toBe(3); // last 3 wins
    expect(streaks.worstLossStreak).toBe(3); // the 3 losses in the middle
    expect(streaks.currentType).toBe("WIN");
    expect(streaks.currentCount).toBe(3);
  });

  it("returns a null current streak for no trades", () => {
    expect(computeStreaks([])).toEqual({ currentType: null, currentCount: 0, bestWinStreak: 0, worstLossStreak: 0 });
  });
});

describe("computeDayOfWeekStats", () => {
  it("buckets trades by UTC weekday without assuming a pattern exists for empty days", () => {
    // 2026-01-05 is a Monday
    const monday = new Date("2026-01-05T12:00:00Z");
    const stats = computeDayOfWeekStats([trade({ closedAt: monday, netPnl: 5 }), trade({ closedAt: monday, netPnl: -1 })]);
    const mondayStat = stats.find((s) => s.label === "Lunes")!;
    expect(mondayStat.trades).toBe(2);
    expect(mondayStat.totalPnl).toBe(4);
    const tuesdayStat = stats.find((s) => s.label === "Martes")!;
    expect(tuesdayStat.trades).toBe(0);
    expect(tuesdayStat.winRate).toBe(0);
  });
});

describe("bestWorstDays / bestWorstTrade", () => {
  it("picks the best and worst days by P&L", () => {
    const daily = computeDailyStats(
      [
        trade({ closedAt: new Date("2026-01-01T00:00:00Z"), netPnl: 10 }),
        trade({ closedAt: new Date("2026-01-02T00:00:00Z"), netPnl: -20 }),
        trade({ closedAt: new Date("2026-01-03T00:00:00Z"), netPnl: 3 }),
      ],
      100
    );
    const { best, worst } = bestWorstDays(daily, 2);
    expect(best[0].date).toBe("2026-01-01");
    expect(worst[0].date).toBe("2026-01-02");
  });

  it("finds the single best and worst trade", () => {
    const trades = [trade({ closedAt: new Date(), netPnl: 2 }), trade({ closedAt: new Date(), netPnl: -9 }), trade({ closedAt: new Date(), netPnl: 5 })];
    const { best, worst } = bestWorstTrade(trades);
    expect(best?.netPnl).toBe(5);
    expect(worst?.netPnl).toBe(-9);
  });

  it("returns nulls for an empty trade list rather than throwing", () => {
    expect(bestWorstTrade([])).toEqual({ best: null, worst: null });
  });
});

describe("groupPerformance", () => {
  it("groups trades by an arbitrary key and computes stats per group, sorted by total P&L desc", () => {
    const trades = [
      trade({ closedAt: new Date(), netPnl: 5, strategyName: "Momentum" }),
      trade({ closedAt: new Date(), netPnl: -1, strategyName: "Momentum" }),
      trade({ closedAt: new Date(), netPnl: 20, strategyName: "Trend Following" }),
    ];
    const groups = groupPerformance(
      trades,
      (t) => t.strategyName,
      (key) => key
    );
    expect(groups[0].label).toBe("Trend Following"); // highest total P&L first
    expect(groups[0].stats.totalNetPnl).toBe(20);
    expect(groups[1].stats.trades).toBe(2);
  });
});

describe("computeDrawdownWithDuration", () => {
  it("computes zero drawdown on a monotonically increasing equity curve", () => {
    const daily = computeDailyStats(
      [
        trade({ closedAt: new Date("2026-01-01T00:00:00Z"), netPnl: 10 }),
        trade({ closedAt: new Date("2026-01-02T00:00:00Z"), netPnl: 10 }),
      ],
      100
    );
    const dd = computeDrawdownWithDuration(daily);
    expect(dd.current).toBe(0);
    expect(dd.max).toBe(0);
  });

  it("tracks drawdown duration in days from the last peak", () => {
    const daily = computeDailyStats(
      [
        trade({ closedAt: new Date("2026-01-01T00:00:00Z"), netPnl: 50 }), // peak: 150
        trade({ closedAt: new Date("2026-01-02T00:00:00Z"), netPnl: -30 }), // 120, dd from 150
        trade({ closedAt: new Date("2026-01-03T00:00:00Z"), netPnl: -10 }), // 110, still under peak
      ],
      100
    );
    const dd = computeDrawdownWithDuration(daily);
    expect(dd.max).toBeCloseTo(((150 - 110) / 150) * 100, 6);
    expect(dd.currentDurationDays).toBe(2); // 2 days since the peak on day 0
  });
});
