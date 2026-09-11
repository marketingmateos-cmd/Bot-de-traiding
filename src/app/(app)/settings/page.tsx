import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getBudgetStatus } from "@/lib/engines/aiBudget";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatTile } from "@/components/ui/StatTile";
import { RiskProfileForm } from "@/components/settings/RiskProfileForm";
import { CircuitBreakerList } from "@/components/settings/CircuitBreakerList";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function SettingsPage() {
  const account = await prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } });
  const breakers = await prisma.circuitBreaker.findMany({ orderBy: { name: "asc" } });
  const budget = await getBudgetStatus();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-muted">Provider status, risk configuration, AI budget, and circuit breaker management.</p>
      </div>

      <Card title="Environment" subtitle={`APP_ENV=${env.appEnv}`}>
        <div className="flex flex-wrap gap-2">
          <Badge tone={env.isDemoMarketData ? "muted" : "success"}>Market Data: {env.isDemoMarketData ? "DEMO" : "LIVE"}</Badge>
          <Badge tone={env.isDemoNews ? "muted" : "success"}>News: {env.isDemoNews ? "DEMO" : "LIVE"}</Badge>
          <Badge tone={env.isDemoSentiment ? "muted" : "success"}>Sentiment: {env.isDemoSentiment ? "DEMO" : "LIVE"}</Badge>
          <Badge tone={env.isDemoOnChain ? "muted" : "success"}>On-Chain: {env.isDemoOnChain ? "DEMO" : "LIVE"}</Badge>
          <Badge tone={env.hasAnthropicKey ? "success" : "muted"}>AI: {env.hasAnthropicKey ? `LIVE (${env.aiModel})` : "DEMO (rule-based)"}</Badge>
        </div>
      </Card>

      <Card title="Risk Profile">
        <RiskProfileForm accountId={ACCOUNT_ID} current={account?.riskProfile ?? "BALANCED"} />
      </Card>

      <Card title="AI Budget">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Calls Today" value={`${budget.callsToday}/${budget.dailyBudget}`} />
          <StatTile label="Est. Monthly Cost" value={`$${budget.monthlyCostUsd.toFixed(2)} / $${budget.monthlyCostBudgetUsd}`} />
          <StatTile label="Cache Hit Rate" value={`${(budget.cacheHitRate * 100).toFixed(0)}%`} />
          <StatTile label="Mode" value={budget.shouldUseCacheOnly ? "Cache Only" : budget.shouldThrottle ? "Throttled" : "Normal"} />
        </div>
      </Card>

      <Card title="Circuit Breakers">
        <CircuitBreakerList breakers={breakers} accountId={ACCOUNT_ID} />
      </Card>
    </div>
  );
}
