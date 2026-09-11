import { describe, expect, it } from "vitest";
import { rankStrategies, type LeagueEntryInput } from "../strategyLeague";
import type { StrategyPerformanceStats } from "../strategyStats";

function stats(overrides: Partial<StrategyPerformanceStats>): StrategyPerformanceStats {
  return { trades: 0, winRate: 0, avgReturnPct: 0, sharpe: null, sortino: null, maxDrawdownPct: 0, totalNetPnl: 0, profitFactor: null, ...overrides };
}

describe("rankStrategies", () => {
  it("does NOT rank raw return above risk-adjusted, well-evidenced performance", () => {
    const entries: LeagueEntryInput[] = [
      {
        strategyVersionId: "lucky",
        strategyName: "Lucky Streak",
        version: "1.0",
        stats: stats({ trades: 4, winRate: 1, sharpe: 8, sortino: 8, maxDrawdownPct: 1, totalNetPnl: 500 }),
        robustnessScore: null,
        oosSharpe: null,
        benchmarkReturnPct: null,
      },
      {
        strategyVersionId: "solid",
        strategyName: "Solid Performer",
        version: "1.0",
        stats: stats({ trades: 150, winRate: 0.56, sharpe: 1.4, sortino: 1.6, maxDrawdownPct: 10, totalNetPnl: 80 }),
        robustnessScore: 70,
        oosSharpe: 0.9,
        benchmarkReturnPct: 20,
      },
    ];

    const ranked = rankStrategies(entries);
    const solid = ranked.find((r) => r.strategyVersionId === "solid")!;
    const lucky = ranked.find((r) => r.strategyVersionId === "lucky")!;
    expect(solid.compositeScore).toBeGreaterThan(lucky.compositeScore);
    expect(solid.rank).toBeLessThan(lucky.rank);
  });

  it("assigns rank 1..N with no gaps or duplicates", () => {
    const entries: LeagueEntryInput[] = Array.from({ length: 5 }, (_, i) => ({
      strategyVersionId: `s${i}`,
      strategyName: `Strategy ${i}`,
      version: "1.0",
      stats: stats({ trades: i * 20, winRate: 0.5, sharpe: i * 0.2 }),
      robustnessScore: null,
      oosSharpe: null,
      benchmarkReturnPct: null,
    }));
    const ranked = rankStrategies(entries);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("gives a strategy with zero trades a low composite score regardless of other inputs", () => {
    const entries: LeagueEntryInput[] = [
      { strategyVersionId: "empty", strategyName: "No Trades", version: "1.0", stats: stats({ trades: 0 }), robustnessScore: 100, oosSharpe: 3, benchmarkReturnPct: 0 },
    ];
    const [ranked] = rankStrategies(entries);
    expect(ranked.compositeScore).toBeLessThan(30);
  });
});
