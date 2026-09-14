import { describe, expect, it } from "vitest";
import { buildDailyPnlSeries, alignDailySeries, computeReturnCorrelation, computeTemporalOverlap, compareHypothesisToStrategy } from "../phase20Comparison";
import type { ReplayTradeRecord } from "@/lib/replay/types";

function trade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "s",
    strategyName: "S",
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

describe("buildDailyPnlSeries", () => {
  it("sums netPnl by exitTime's UTC calendar date", () => {
    const trades = [trade({ exitTime: "2026-01-01T05:00:00.000Z", netPnl: 10 }), trade({ exitTime: "2026-01-01T20:00:00.000Z", netPnl: -3 }), trade({ exitTime: "2026-01-02T02:00:00.000Z", netPnl: 4 })];
    const series = buildDailyPnlSeries(trades);
    expect(series.dates).toEqual(["2026-01-01", "2026-01-02"]);
    expect(series.pnl).toEqual([7, 4]);
  });

  it("returns an empty series for no trades", () => {
    expect(buildDailyPnlSeries([])).toEqual({ dates: [], pnl: [] });
  });
});

describe("alignDailySeries", () => {
  it("fills missing days with 0 on the union of both date sets", () => {
    const a = { dates: ["2026-01-01", "2026-01-03"], pnl: [10, 20] };
    const b = { dates: ["2026-01-02", "2026-01-03"], pnl: [5, -5] };
    const aligned = alignDailySeries(a, b);
    expect(aligned.datesUnion).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(aligned.aAligned).toEqual([10, 0, 20]);
    expect(aligned.bAligned).toEqual([0, 5, -5]);
  });
});

describe("computeReturnCorrelation", () => {
  it("returns null when there are fewer than 3 union days", () => {
    const a = [trade({ exitTime: "2026-01-01T00:00:00.000Z" })];
    const b = [trade({ exitTime: "2026-01-01T00:00:00.000Z" })];
    expect(computeReturnCorrelation(a, b)).toBeNull();
  });

  it("is exactly 1 for two identical daily P&L series", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
    const a = days.map((d, i) => trade({ exitTime: `${d}T00:00:00.000Z`, netPnl: (i % 2 === 0 ? 1 : -1) * (i + 1) }));
    const b = days.map((d, i) => trade({ exitTime: `${d}T00:00:00.000Z`, netPnl: (i % 2 === 0 ? 1 : -1) * (i + 1) }));
    const rho = computeReturnCorrelation(a, b);
    expect(rho).not.toBeNull();
    expect(rho as number).toBeCloseTo(1, 5);
  });
});

describe("computeTemporalOverlap", () => {
  it("is 0 when A has no trades", () => {
    expect(computeTemporalOverlap([], [trade()])).toBe(0);
  });

  it("is 1 when every A trade's interval overlaps some B trade", () => {
    const a = [trade({ entryTime: "2026-01-01T00:00:00.000Z", exitTime: "2026-01-01T02:00:00.000Z" })];
    const b = [trade({ entryTime: "2026-01-01T01:00:00.000Z", exitTime: "2026-01-01T03:00:00.000Z" })];
    expect(computeTemporalOverlap(a, b)).toBe(1);
  });

  it("is 0 when no A interval overlaps any B interval", () => {
    const a = [trade({ entryTime: "2026-01-01T00:00:00.000Z", exitTime: "2026-01-01T01:00:00.000Z" })];
    const b = [trade({ entryTime: "2026-02-01T00:00:00.000Z", exitTime: "2026-02-01T01:00:00.000Z" })];
    expect(computeTemporalOverlap(a, b)).toBe(0);
  });
});

describe("compareHypothesisToStrategy", () => {
  it("classifies INSUFICIENTE_MUESTRA when either side is below MIN_SAMPLE_SIZE", () => {
    const a = Array.from({ length: 5 }, () => trade());
    const b = Array.from({ length: 30 }, () => trade());
    const result = compareHypothesisToStrategy(a, b, "some-strategy-v1");
    expect(result.classification).toBe("INSUFICIENTE_MUESTRA");
  });

  it("classifies REDUNDANTE_MISMO_EFECTO for high correlation + high temporal overlap with sufficient samples", () => {
    const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)));
    const a = days.map((d) => trade({ entryTime: d.toISOString(), exitTime: new Date(d.getTime() + 3_600_000).toISOString(), netPnl: (d.getUTCDate() % 3) - 1 }));
    const b = days.map((d) => trade({ entryTime: d.toISOString(), exitTime: new Date(d.getTime() + 3_600_000).toISOString(), netPnl: (d.getUTCDate() % 3) - 1 }));
    const result = compareHypothesisToStrategy(a, b, "identical-strategy-v1");
    expect(result.classification).toBe("REDUNDANTE_MISMO_EFECTO");
  });

  it("classifies DISTINTA_INCREMENTAL for low correlation + low temporal overlap with sufficient samples", () => {
    const daysA = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)));
    const daysB = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 5, 1 + i))); // entirely different months — no temporal overlap
    const a = daysA.map((d, i) => trade({ entryTime: d.toISOString(), exitTime: new Date(d.getTime() + 3_600_000).toISOString(), netPnl: i % 2 === 0 ? 5 : -5 }));
    const b = daysB.map((d, i) => trade({ entryTime: d.toISOString(), exitTime: new Date(d.getTime() + 3_600_000).toISOString(), netPnl: i % 2 === 0 ? -5 : 5 }));
    const result = compareHypothesisToStrategy(a, b, "unrelated-strategy-v1");
    expect(result.temporalOverlap).toBe(0);
    expect(result.classification).toBe("DISTINTA_INCREMENTAL");
  });
});
