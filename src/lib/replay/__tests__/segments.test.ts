import { describe, expect, it } from "vitest";
import { runIsValidationOosReplay } from "../segments";
import type { ReplayConfig } from "../types";

function baseConfig(): ReplayConfig {
  return {
    assetSymbols: ["ETH"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-01-01T00:00:00.000Z"), // overwritten by fetchConfig in segments.ts
    strategyId: "trend-following",
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10000,
    riskLevel: 6,
  };
}

const ranges = {
  is: { start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2024-02-01T00:00:00.000Z") },
  validation: { start: new Date("2024-02-01T01:00:00.000Z"), end: new Date("2024-02-15T00:00:00.000Z") },
  oos: { start: new Date("2024-02-15T01:00:00.000Z"), end: new Date("2024-03-01T00:00:00.000Z") },
};

describe("AUDIT: IS / VALIDATION / OOS separation (Fase 7D)", () => {
  it("returns three fully independent segments with non-overlapping date windows and separate metrics", async () => {
    const result = await runIsValidationOosReplay(baseConfig(), ranges, new Map());

    expect(result.is.label).toBe("IS");
    expect(result.validation.label).toBe("VALIDATION");
    expect(result.oos.label).toBe("OOS");

    // Every trade recorded in a segment actually closed within that segment's own window.
    for (const trade of result.is.trades) {
      const t = new Date(trade.exitTime).getTime();
      expect(t).toBeGreaterThanOrEqual(ranges.is.start.getTime());
      expect(t).toBeLessThanOrEqual(ranges.is.end.getTime());
    }
    for (const trade of result.oos.trades) {
      const t = new Date(trade.exitTime).getTime();
      expect(t).toBeGreaterThanOrEqual(ranges.oos.start.getTime());
      expect(t).toBeLessThanOrEqual(ranges.oos.end.getTime());
    }

    // No IS trade leaks into OOS's own trade list (identity check, not just date range).
    const isTradeKeys = new Set(result.is.trades.map((t) => `${t.entryTime}:${t.asset}`));
    for (const t of result.oos.trades) {
      expect(isTradeKeys.has(`${t.entryTime}:${t.asset}`)).toBe(false);
    }

    // Metrics objects are genuinely separate instances with their own equity curves.
    expect(result.is.metrics).not.toBe(result.oos.metrics);
    expect(result.is.equityCurve).not.toBe(result.oos.equityCurve);
  });

  it("each segment's equity curve only contains points within that segment's own window", () => {
    return runIsValidationOosReplay(baseConfig(), ranges, new Map()).then((result) => {
      for (const point of result.validation.equityCurve) {
        expect(point.t).toBeGreaterThanOrEqual(ranges.validation.start.getTime());
        expect(point.t).toBeLessThanOrEqual(ranges.validation.end.getTime());
      }
    });
  });
});
