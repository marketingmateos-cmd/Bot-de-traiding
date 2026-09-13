import { prisma } from "@/lib/db";
import { getSymbolAnalysis } from "@/lib/orchestrator";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { toJson } from "@/lib/json";
import { detectAnomalies, computeSystemHealthScore, type Anomaly } from "./anomalyDetector";

export interface SystemHealthSnapshot {
  score: number;
  anomalies: Anomaly[];
  avgDataQuality: number;
}

/**
 * Fase 2 fix — the `SystemHealth` table (spec §38) was fully dead: the
 * System Health page computed a health score live on every page load via
 * detectAnomalies/computeSystemHealthScore, but never persisted it, so
 * there was no history to show a trend from and no record of system
 * health for periods nobody happened to have the page open.
 *
 * This runs the exact same computation the page used to do inline, and
 * additionally records it as a SystemHealth row — called both by the page
 * (so every visit adds a data point) and once per autonomous bot loop
 * cycle (see botLoop.ts), so the history exists independent of anyone
 * looking at the page.
 */
export async function computeAndRecordSystemHealth(accountId: string): Promise<SystemHealthSnapshot> {
  const recentTrades = await prisma.trade.findMany({ where: { accountId }, orderBy: { closedAt: "desc" }, take: 20 });
  const openPositions = await prisma.paperPosition.findMany({ where: { accountId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
  const breakers = await prisma.circuitBreaker.findMany();

  const dataQualities = await Promise.all(SUPPORTED_ASSETS.map((a) => getSymbolAnalysis(a.symbol, "H1")));
  const avgDataQuality = Math.round(dataQualities.reduce((s, a) => s + a.dataQuality.score, 0) / dataQualities.length);

  const seen = new Map<string, string>();
  let duplicateCount = 0;
  for (const p of openPositions) {
    const key = `${p.assetId}:${p.strategyVersionId}:${p.direction}`;
    if (seen.has(key)) duplicateCount++;
    seen.set(key, p.id);
  }

  const reconciliationConsistent = breakers.find((b) => b.name === "position-inconsistency")?.isTripped !== true;

  const anomalies = detectAnomalies({
    recentTradePnls: recentTrades.map((t) => t.netPnl),
    duplicateOpenPositionCount: duplicateCount,
    dataQualityScore: avgDataQuality,
    apiHealthy: true,
    reconciliationConsistent,
    priceJumpPct: null,
  });
  const score = computeSystemHealthScore(anomalies, avgDataQuality, true);

  await prisma.systemHealth.create({
    data: {
      score,
      components: toJson({
        dataQuality: avgDataQuality,
        apiHealth: true,
        positionConsistency: reconciliationConsistent,
        anomalyCount: anomalies.length,
      }),
    },
  });

  return { score, anomalies, avgDataQuality };
}
