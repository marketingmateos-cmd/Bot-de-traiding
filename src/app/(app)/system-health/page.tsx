import { prisma } from "@/lib/db";
import { getSymbolAnalysis } from "@/lib/orchestrator";
import { detectAnomalies, computeSystemHealthScore } from "@/lib/engines/anomalyDetector";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScoreBar } from "@/components/ui/StatTile";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function SystemHealthPage() {
  const recentTrades = await prisma.trade.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { closedAt: "desc" }, take: 20 });
  const openPositions = await prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
  const breakers = await prisma.circuitBreaker.findMany();
  const alerts = await prisma.systemAlert.findMany({ orderBy: { createdAt: "desc" }, take: 15 });

  const dataQualities = await Promise.all(SUPPORTED_ASSETS.map((a) => getSymbolAnalysis(a.symbol, "H1")));
  const avgDataQuality = Math.round(dataQualities.reduce((s, a) => s + a.dataQuality.score, 0) / dataQualities.length);

  const seen = new Map<string, string>();
  let duplicateCount = 0;
  for (const p of openPositions) {
    const key = `${p.assetId}:${p.strategyVersionId}:${p.direction}`;
    if (seen.has(key)) duplicateCount++;
    seen.set(key, p.id);
  }

  const anomalies = detectAnomalies({
    recentTradePnls: recentTrades.map((t) => t.netPnl),
    duplicateOpenPositionCount: duplicateCount,
    dataQualityScore: avgDataQuality,
    apiHealthy: true,
    reconciliationConsistent: breakers.find((b) => b.name === "position-inconsistency")?.isTripped !== true,
    priceJumpPct: null,
  });
  const healthScore = computeSystemHealthScore(anomalies, avgDataQuality, true);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">System Health</h1>
        <p className="mt-1 text-sm text-muted">Anomaly detection across trades, positions, and data feeds.</p>
      </div>

      <Card title="System Health Score">
        <div className="mb-3 font-mono text-4xl font-bold text-accent">
          {healthScore}
          <span className="text-base text-muted">/100</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ScoreBar label="Avg Data Quality" value={avgDataQuality} />
          <ScoreBar label="Anomaly-Free Score" value={Math.max(0, 100 - anomalies.length * 15)} />
        </div>
      </Card>

      <Card title="Detected Anomalies">
        {anomalies.length === 0 ? (
          <p className="text-sm text-accent">No anomalies detected.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {anomalies.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge tone={a.severity === "HIGH" ? "danger" : a.severity === "MEDIUM" ? "warn" : "muted"}>{a.severity}</Badge>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent System Alerts">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted">No alerts recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-xs">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <Badge tone={a.severity === "CRITICAL" ? "danger" : a.severity === "WARN" ? "warn" : "info"}>{a.severity}</Badge>
                <div>
                  <div className="font-medium text-slate-200">{a.title}</div>
                  <div className="text-muted">{a.message}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
