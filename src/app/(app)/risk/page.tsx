import { prisma } from "@/lib/db";
import { resolveRiskLimits, type RiskProfile } from "@/lib/engines/riskEngine";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { CircuitBreakerList } from "@/components/settings/CircuitBreakerList";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function RiskPage() {
  const account = await prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } });
  const breakers = await prisma.circuitBreaker.findMany({ orderBy: { name: "asc" } });
  const openPositions = await prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });

  const riskProfile = (account?.riskProfile ?? "BALANCED") as RiskProfile;
  const limits = resolveRiskLimits(riskProfile);
  const equity = account?.cashBalance ?? 100;
  const exposure = openPositions.reduce((s, p) => s + p.entryPrice * p.remainingQuantity, 0);
  const exposurePct = equity > 0 ? (exposure / equity) * 100 : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Risk Center</h1>
        <p className="mt-1 text-sm text-muted">Independent from strategy/AI decisions — the Trade Gate cannot override these limits.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Risk Profile" value={riskProfile} />
        <StatTile label="Risk / Trade" value={`${limits.riskPerTradePct}%`} />
        <StatTile label="Max Exposure" value={`${limits.maxExposurePct}%`} sublabel={`Current: ${exposurePct.toFixed(1)}%`} tone={exposurePct > limits.maxExposurePct ? "negative" : "neutral"} />
        <StatTile label="Max Open Positions" value={limits.maxOpenPositions} sublabel={`Current: ${openPositions.length}`} />
        <StatTile label="Max Daily Loss" value={`${limits.maxDailyLossPct}%`} />
        <StatTile label="Max Drawdown" value={`${limits.maxDrawdownPct}%`} />
      </div>

      <Card title="Circuit Breakers" subtitle="Independent emergency mechanisms — a tripped breaker blocks ALL new simulated trades until resolved.">
        <CircuitBreakerList breakers={breakers} accountId={ACCOUNT_ID} />
      </Card>
    </div>
  );
}
