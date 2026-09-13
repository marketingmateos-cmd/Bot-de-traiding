import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

// Fase 2 — the SystemHealth table was fully dead: the System Health page
// computed a score live on every visit but never persisted it, so there was
// no history for periods nobody had the page open. computeAndRecordSystemHealth
// runs the same computation and now writes a SystemHealth row every time.

vi.mock("@/lib/orchestrator", () => ({
  getSymbolAnalysis: async (symbol: string) => ({
    symbol,
    timeframe: "H1",
    bars: [],
    isDemo: true,
    source: "mock",
    dataQuality: { score: 80, issues: [], blocksTrading: false },
    features: null,
    regime: { regime: "BULL", confidence: 0.8, details: { trendSlopePct: 1, volatilityPercentile: 40, rangeWidthPct: 2 } },
    news: { score: 60, topStories: [], clusterCount: 0, totalArticles: 0 },
    sentiment: { current: 0.2, trend: 0.1, acceleration: 0, divergence: false, divergenceMagnitude: 0, score: 60 },
    onChain: [],
    marketIntelligence: null,
    priceChangePct: 0,
    latestPrice: 100,
  }),
}));

const { computeAndRecordSystemHealth } = await import("../systemHealth");

let userId: string;
let accountId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `system-health-audit-${Date.now()}@example.com`, name: "System Health Audit" } });
  userId = user.id;
  const account = await prisma.paperAccount.create({
    data: { userId, name: "System Health Audit Account", startingBalance: 10000, cashBalance: 10000 },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.systemHealth.deleteMany({});
  await prisma.paperAccount.delete({ where: { id: accountId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("computeAndRecordSystemHealth (Fase 2 — SystemHealth was a dead table)", () => {
  it("persists a SystemHealth row with the computed score and component breakdown", async () => {
    const before = await prisma.systemHealth.count();
    const snapshot = await computeAndRecordSystemHealth(accountId);

    expect(snapshot.score).toBeGreaterThanOrEqual(0);
    expect(snapshot.score).toBeLessThanOrEqual(100);

    const after = await prisma.systemHealth.count();
    expect(after).toBe(before + 1);

    const latest = await prisma.systemHealth.findFirst({ orderBy: { evaluatedAt: "desc" } });
    expect(latest).not.toBeNull();
    expect(latest!.score).toBe(snapshot.score);
    const components = JSON.parse(latest!.components);
    expect(components).toMatchObject({ dataQuality: snapshot.avgDataQuality, apiHealth: true, positionConsistency: true, anomalyCount: snapshot.anomalies.length });
  });

  it("adds a new row every call — building real history rather than overwriting a single snapshot", async () => {
    const before = await prisma.systemHealth.count();
    await computeAndRecordSystemHealth(accountId);
    await computeAndRecordSystemHealth(accountId);
    const after = await prisma.systemHealth.count();
    expect(after).toBe(before + 2);
  });
});
