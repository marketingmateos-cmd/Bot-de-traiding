import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import { resolveAiForMode, resolveDeterministic, resolveFullHistorical } from "../aiModes";
import type { AIAnalystInput, AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";

// Fase 7B — the three AI modes. Every path here is checked against the
// same absolute rule: never fabricate a historical answer. FULL_HISTORICAL
// must say UNAVAILABLE when no real record exists (the overwhelmingly
// common case in this environment — see historicalDataProvider.ts's doc
// comment), and must use the REAL stored row when one genuinely does.

const analystInput: AIAnalystInput = {
  symbol: "BTC",
  timeframe: "H1",
  regime: "BULL",
  indicators: { trend: 0.5, momentum: 0.3, rsi: 55, volumeZScore: 0 },
  marketIntelligence: 70,
  news: [],
  sentiment: { score: 60, trend: 0.1, divergence: false },
  onChain: {},
  strategySignal: { kind: "TREND_FOLLOWING", direction: "LONG", strength: 0.8 },
  riskContext: { accountEquity: 10000, openExposurePct: 0.1 },
};

describe("AUDIT: FULL_HISTORICAL mode never fabricates — real data or explicit unavailability (Fase 7B)", () => {
  it("reports UNAVAILABLE when no real AIAnalysis row exists near that timestamp", async () => {
    const result = await resolveFullHistorical("nonexistent-asset-id", "TREND_FOLLOWING", Date.now());
    expect(result.available).toBe(false);
    expect(result.availability).toBe("UNAVAILABLE");
    expect(result.analyst).toBeNull();
    expect(result.critic).toBeNull();
  });

  describe("with a genuine historical AIAnalysis row present", () => {
    let assetId: string;
    const analystOutput: AIAnalystOutput = { signal: "LONG", confidence: 0.8, reasons: ["real historical reason"], risks: [], invalidation_conditions: [], data_quality: 90, recommendation: "APPROVE" };
    const criticOutput: AICriticOutput = { verdict: "APPROVED", challengedReasons: [], biasesFound: [], overfittingConcern: false, notes: "real historical critique" };
    const historicalTimestamp = new Date("2024-06-15T12:00:00.000Z");

    it("uses the REAL stored row when one exists within tolerance of the replay timestamp", async () => {
      const asset = await prisma.asset.create({ data: { symbol: `AIFH${Date.now() % 100000}`, name: "AI Full Historical Test Asset" } });
      assetId = asset.id;

      await prisma.aIAnalysis.create({
        data: { kind: "ANALYST", assetId, input: toJson({}), output: toJson(analystOutput), model: "test-real", createdAt: historicalTimestamp },
      });
      await prisma.aIAnalysis.create({
        data: { kind: "CRITIC", assetId, input: toJson({}), output: toJson(criticOutput), model: "test-real", createdAt: historicalTimestamp },
      });

      const result = await resolveFullHistorical(assetId, "TREND_FOLLOWING", historicalTimestamp.getTime());
      expect(result.available).toBe(true);
      expect(result.availability).toBe("REAL_HISTORICAL");
      expect(result.analyst).toEqual(analystOutput);
      expect(result.critic).toEqual(criticOutput);

      await prisma.aIAnalysis.deleteMany({ where: { assetId } });
      await prisma.asset.delete({ where: { id: assetId } });
    });
  });
});

describe("AUDIT: DETERMINISTIC_AI mode is a pure, reproducible function (Fase 7B)", () => {
  it("returns the exact same output for the exact same input, every time", async () => {
    const [a, b, c] = await Promise.all([resolveDeterministic(analystInput), resolveDeterministic(analystInput), resolveDeterministic(analystInput)]);
    expect(a.analyst).toEqual(b.analyst);
    expect(b.analyst).toEqual(c.analyst);
    expect(a.critic).toEqual(b.critic);
    expect(a.availability).toBe("DETERMINISTIC_SYNTHETIC");
  });

  it("changes output when the input genuinely changes (not a constant stub)", async () => {
    const bullish = await resolveDeterministic(analystInput);
    const bearish = await resolveDeterministic({ ...analystInput, strategySignal: { kind: "TREND_FOLLOWING", direction: "SHORT", strength: 0.8 }, regime: "BEAR" });
    expect(bullish.analyst?.signal).not.toBe(bearish.analyst?.signal);
  });
});

describe("AUDIT: resolveAiForMode dispatches to the right mode and tags availability accordingly", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("FULL_HISTORICAL with no data returns UNAVAILABLE via the dispatcher too", async () => {
    const result = await resolveAiForMode("FULL_HISTORICAL", "nonexistent", "TREND_FOLLOWING", Date.now(), analystInput, undefined);
    expect(result.availability).toBe("UNAVAILABLE");
  });

  it("DETERMINISTIC_AI via the dispatcher matches calling resolveDeterministic directly", async () => {
    const viaDispatcher = await resolveAiForMode("DETERMINISTIC_AI", "any", "TREND_FOLLOWING", Date.now(), analystInput, undefined);
    const direct = await resolveDeterministic(analystInput);
    expect(viaDispatcher.analyst).toEqual(direct.analyst);
    expect(viaDispatcher.availability).toBe("DETERMINISTIC_SYNTHETIC");
  });

  it("AI_ASSISTED via the dispatcher is tagged EXPERIMENTAL_LIVE, never presented as historical", async () => {
    const result = await resolveAiForMode("AI_ASSISTED", "any", "TREND_FOLLOWING", Date.now(), analystInput, undefined);
    expect(result.availability).toBe("EXPERIMENTAL_LIVE");
    expect(result.available).toBe(true);
  });
});
