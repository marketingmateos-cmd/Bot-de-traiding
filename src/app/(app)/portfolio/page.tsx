import { prisma } from "@/lib/db";
import { computeDrawdown } from "@/lib/engines/riskEngine";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Badge } from "@/components/ui/Badge";
import { EquityCurveChart } from "@/components/charts/EquityCurveChart";
import { tDirection, tRiskProfile } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function PortfolioPage() {
  const account = await prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } });
  const trades = await prisma.trade.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { closedAt: "asc" }, include: { asset: true } });
  const openPositions = await prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } }, include: { asset: true } });

  const startingBalance = account?.startingBalance ?? 100;
  let running = startingBalance;
  const equityCurve = [{ t: Date.now() - trades.length * 3600_000, equity: running }];
  for (const t of trades) {
    running += t.netPnl;
    equityCurve.push({ t: t.closedAt.getTime(), equity: running });
  }
  const drawdown = computeDrawdown(equityCurve.map((e) => e.equity));

  const realizedPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);
  const totalSlippage = trades.reduce((s, t) => s + t.slippageCost, 0);
  const unrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const exposure = openPositions.reduce((s, p) => s + p.entryPrice * p.remainingQuantity, 0);
  const equity = account?.cashBalance ?? startingBalance;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Cartera</h1>
        <p className="mt-1 text-sm text-muted">Cuenta virtual — balance inicial €{startingBalance.toFixed(2)}, 100% simulada.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Balance (efectivo)" value={`€${equity.toFixed(2)}`} />
        <StatTile label="P&L Realizado" value={`€${realizedPnl.toFixed(2)}`} tone={realizedPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="P&L No Realizado" value={`€${unrealizedPnl.toFixed(2)}`} tone={unrealizedPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="Exposición" value={`€${exposure.toFixed(2)}`} sublabel={`${((exposure / Math.max(1, equity)) * 100).toFixed(0)}% del equity`} />
        <StatTile label="Comisiones Pagadas" value={`€${totalFees.toFixed(2)}`} />
        <StatTile label="Coste de Slippage" value={`€${totalSlippage.toFixed(2)}`} />
        <StatTile label="Drawdown" value={`${drawdown.current.toFixed(1)}%`} sublabel={`Máx ${drawdown.max.toFixed(1)}%`} />
        <StatTile label="Perfil de Riesgo" value={tRiskProfile(account?.riskProfile ?? "BALANCED")} />
      </div>

      <Card title="Curva de Equity">
        {equityCurve.length > 2 ? <EquityCurveChart data={equityCurve} /> : <p className="text-sm text-muted">Aún no hay suficiente historial de operaciones.</p>}
      </Card>

      <Card title="Posiciones" subtitle={`${openPositions.length} abierta(s)`}>
        {openPositions.length === 0 ? (
          <p className="text-sm text-muted">No hay posiciones abiertas.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {openPositions.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                <span className="font-medium">{p.asset.symbol}</span>
                <Badge tone={p.direction === "LONG" ? "success" : "danger"}>{tDirection(p.direction)}</Badge>
                <span className="font-mono">{p.remainingQuantity.toFixed(4)} @ {p.entryPrice.toFixed(2)}</span>
                <span className={`font-mono ${p.unrealizedPnl >= 0 ? "text-accent" : "text-danger"}`}>{p.unrealizedPnl.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
