import { prisma } from "@/lib/db";
import { resolveRiskLimitsForLevel, riskPresetForLevel } from "@/lib/engines/riskEngine";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { CircuitBreakerList } from "@/components/settings/CircuitBreakerList";
import { tRiskProfile } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function RiskPage() {
  const account = await prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } });
  const breakers = await prisma.circuitBreaker.findMany({ orderBy: { name: "asc" } });
  const openPositions = await prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });

  const riskLevel = account?.riskLevel ?? 5;
  const limits = resolveRiskLimitsForLevel(riskLevel);
  const equity = account?.cashBalance ?? 100;
  const exposure = openPositions.reduce((s, p) => s + p.entryPrice * p.remainingQuantity, 0);
  const exposurePct = equity > 0 ? (exposure / equity) * 100 : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Centro de Riesgo</h1>
        <p className="mt-1 text-sm text-muted">Independiente de las decisiones de estrategia/IA — el Trade Gate no puede saltarse estos límites.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Risk Level" value={`${riskLevel}/10`} sublabel={tRiskProfile(riskPresetForLevel(riskLevel))} />
        <StatTile label="Riesgo / Operación" value={`${limits.riskPerTradePct}%`} />
        <StatTile label="Exposición Máxima" value={`${limits.maxExposurePct}%`} sublabel={`Actual: ${exposurePct.toFixed(1)}%`} tone={exposurePct > limits.maxExposurePct ? "negative" : "neutral"} />
        <StatTile label="Máx. Posiciones Abiertas" value={limits.maxOpenPositions} sublabel={`Actual: ${openPositions.length}`} />
        <StatTile label="Pérdida Diaria Máxima" value={`${limits.maxDailyLossPct}%`} />
        <StatTile label="Drawdown Máximo" value={`${limits.maxDrawdownPct}%`} />
        <StatTile label="Concentración Máx. por Activo" value={`${limits.maxConcentrationPct}%`} sublabel="Suma de todas las estrategias en un mismo activo" />
      </div>

      <Card title="Cortafuegos" subtitle="Mecanismos de emergencia independientes — un cortafuegos activado bloquea TODAS las nuevas operaciones simuladas hasta resolverse.">
        <CircuitBreakerList breakers={breakers} accountId={ACCOUNT_ID} />
      </Card>
    </div>
  );
}
