import { prisma } from "@/lib/db";
import { computeAndRecordSystemHealth } from "@/lib/engines/systemHealth";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScoreBar } from "@/components/ui/StatTile";
import { tEvidenceLevel, tSeverity } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function SystemHealthPage() {
  const alerts = await prisma.systemAlert.findMany({ orderBy: { createdAt: "desc" }, take: 15 });

  // Also persists this snapshot to the SystemHealth table (Fase 2 fix — see
  // systemHealth.ts) so every visit adds a real history data point, on top
  // of the once-per-bot-loop-cycle recordings.
  const { score: healthScore, anomalies, avgDataQuality } = await computeAndRecordSystemHealth(ACCOUNT_ID);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Salud del Sistema</h1>
        <p className="mt-1 text-sm text-muted">Detección de anomalías en operaciones, posiciones y fuentes de datos.</p>
      </div>

      <Card title="Puntuación de Salud del Sistema">
        <div className="mb-3 font-mono text-4xl font-bold text-accent">
          {healthScore}
          <span className="text-base text-muted">/100</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ScoreBar label="Calidad de Datos Media" value={avgDataQuality} />
          <ScoreBar label="Puntuación Libre de Anomalías" value={Math.max(0, 100 - anomalies.length * 15)} />
        </div>
      </Card>

      <Card title="Anomalías Detectadas">
        {anomalies.length === 0 ? (
          <p className="text-sm text-accent">No se detectaron anomalías.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {anomalies.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge tone={a.severity === "HIGH" ? "danger" : a.severity === "MEDIUM" ? "warn" : "muted"}>{tEvidenceLevel(a.severity)}</Badge>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Alertas Recientes del Sistema">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted">No hay alertas registradas.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-xs">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <Badge tone={a.severity === "CRITICAL" ? "danger" : a.severity === "WARN" ? "warn" : "info"}>{tSeverity(a.severity)}</Badge>
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
