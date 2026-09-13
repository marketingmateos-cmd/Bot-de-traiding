import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { computeBuyAndHold, compareToBenchmark } from "@/lib/engines/benchmark";
import { runFullReplay } from "../runReplay";
import type { ReplayConfig } from "../types";

function baseConfig(): ReplayConfig {
  return {
    assetSymbols: ["XRP"],
    timeframe: "H1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: new Date("2024-02-01T00:00:00.000Z"),
    strategyId: "trend-following",
    aiMode: "DETERMINISTIC_AI",
    dataSource: "SYNTHETIC",
    initialCapital: 10000,
    riskLevel: 6,
  };
}

describe("AUDIT: Buy & Hold comparison works unmodified against a replay's own bars (Fase 7F)", () => {
  it("computes a real Buy & Hold benchmark from the replay's equity curve timeframe and compares it without hiding a losing strategy result", async () => {
    const config = baseConfig();
    const { result, dataQuality } = await runFullReplay(config, new Map());
    expect(dataQuality.blocksReplay).toBe(false);

    // Rebuild the SAME underlying bars the replay used, purely to prove
    // the existing (unmodified) Buy & Hold engine accepts replay-sourced
    // data with no adapter.
    const { generateHistoricalWalk } = await import("@/lib/providers/market-data/demo-provider");
    const bars = generateHistoricalWalk("XRP", "H1", config.startDate, config.endDate);
    const benchmark = computeBuyAndHold(bars);
    const comparison = compareToBenchmark(result.metrics, benchmark);

    expect(typeof benchmark.totalReturnPct).toBe("number");
    expect(typeof comparison.strategyBeatsReturn).toBe("boolean");
    // The comparison must never suppress an unflattering gap either way.
    expect(comparison.returnGapPct).toBeCloseTo(result.metrics.totalReturnPct - benchmark.totalReturnPct, 5);
  });
});

describe("AUDIT: replay never opens a real PaperOrder (spec test #18 — no real orders)", () => {
  it("leaves the PaperOrder table completely untouched by a replay run", async () => {
    const before = await prisma.paperOrder.count();
    await runFullReplay(baseConfig(), new Map());
    const after = await prisma.paperOrder.count();
    expect(after).toBe(before);
  });
});

describe("AUDIT: synthetic data is never mislabeled as real historical evidence (spec rule #5 / test #15)", () => {
  it("tags every decision's marketData/news/sentiment/onChain availability as SYNTHETIC, never REAL, when dataSource is SYNTHETIC", async () => {
    const { result } = await runFullReplay({ ...baseConfig(), riskLevel: 1, endDate: new Date("2024-04-01T00:00:00.000Z") }, new Map());
    expect(result.decisions.length).toBeGreaterThan(0);
    for (const decision of result.decisions) {
      expect(decision.availability.marketData).toBe("SYNTHETIC");
      expect(decision.availability.news).toBe("SYNTHETIC");
      expect(decision.availability.sentiment).toBe("SYNTHETIC");
      expect(decision.availability.onChain).toBe("SYNTHETIC");
      expect(decision.availability.ai).not.toBe("REAL_HISTORICAL"); // DETERMINISTIC_AI mode never claims real historical
    }
  });
});
