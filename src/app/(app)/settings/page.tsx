import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getBudgetStatus } from "@/lib/engines/aiBudget";
import { computeProfitProtectionStatus } from "@/lib/engines/dailyProfitProtection";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatTile } from "@/components/ui/StatTile";
import { RiskLevelSlider } from "@/components/settings/RiskProfileForm";
import { CircuitBreakerList } from "@/components/settings/CircuitBreakerList";
import { ProfitProtectionForm } from "@/components/settings/ProfitProtectionForm";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

const PROFIT_PROTECTION_TONE = { NORMAL: "success", PROFIT_PROTECTION: "warn", HARD_DAILY_STOP: "danger" } as const;

export default async function SettingsPage() {
  const account = await prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } });
  const breakers = await prisma.circuitBreaker.findMany({ orderBy: { name: "asc" } });
  const budget = await getBudgetStatus();
  const profitProtection = await computeProfitProtectionStatus(ACCOUNT_ID);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Ajustes</h1>
        <p className="mt-1 text-sm text-muted">Estado de los proveedores, configuración de riesgo, presupuesto de IA y gestión de cortafuegos.</p>
      </div>

      <Card title="Entorno" subtitle={`APP_ENV=${env.appEnv}`}>
        <div className="flex flex-wrap gap-2">
          <Badge tone={env.isDemoMarketData ? "muted" : "success"}>Datos de Mercado: {env.isDemoMarketData ? "DEMO" : "EN VIVO"}</Badge>
          <Badge tone={env.isDemoNews ? "muted" : "success"}>Noticias: {env.isDemoNews ? "DEMO" : "EN VIVO"}</Badge>
          <Badge tone={env.isDemoSentiment ? "muted" : "success"}>Sentimiento: {env.isDemoSentiment ? "DEMO" : "EN VIVO"}</Badge>
          <Badge tone={env.isDemoOnChain ? "muted" : "success"}>On-Chain: {env.isDemoOnChain ? "DEMO" : "EN VIVO"}</Badge>
          <Badge tone={env.hasAnthropicKey ? "success" : "muted"}>IA: {env.hasAnthropicKey ? `EN VIVO (${env.aiModel})` : "DEMO (basada en reglas)"}</Badge>
        </div>
      </Card>

      <Card title="Bot Risk">
        <RiskLevelSlider accountId={ACCOUNT_ID} current={account?.riskLevel ?? 5} />
      </Card>

      <Card title="Presupuesto de IA">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Llamadas Hoy" value={`${budget.callsToday}/${budget.dailyBudget}`} />
          <StatTile label="Coste Mensual Est." value={`$${budget.monthlyCostUsd.toFixed(2)} / $${budget.monthlyCostBudgetUsd}`} />
          <StatTile label="Tasa de Acierto de Caché" value={`${(budget.cacheHitRate * 100).toFixed(0)}%`} />
          <StatTile label="Modo" value={budget.shouldUseCacheOnly ? "Solo Caché" : budget.shouldThrottle ? "Restringido" : "Normal"} />
        </div>
      </Card>

      <Card title="Cortafuegos">
        <CircuitBreakerList breakers={breakers} accountId={ACCOUNT_ID} />
      </Card>

      <Card
        title="Daily Profit Protection"
        subtitle="Estado real, calculado a partir del P&L del día — nunca una opinión de la IA"
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge tone={PROFIT_PROTECTION_TONE[profitProtection.state]}>{profitProtection.state}</Badge>
          <span className="font-mono text-sm text-slate-100">
            P&L hoy: {profitProtection.dailyPnlPct >= 0 ? "+" : ""}
            {profitProtection.dailyPnlPct.toFixed(2)}%
          </span>
          <span className="text-xs text-muted">{profitProtection.reason}</span>
        </div>
        <ProfitProtectionForm
          current={{
            isEnabled: profitProtection.config.isEnabled,
            profitProtectionTriggerPct: profitProtection.config.profitProtectionTriggerPct,
            hardStopLossPct: profitProtection.config.hardStopLossPct,
            exceptionalMinConfidence: profitProtection.config.exceptionalMinConfidence,
            exceptionalMinEvidenceLevel: profitProtection.config.exceptionalMinEvidenceLevel,
            exceptionalSizeMultiplier: profitProtection.config.exceptionalSizeMultiplier,
          }}
        />
      </Card>
    </div>
  );
}
