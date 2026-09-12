import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScanPanel } from "@/components/paper-trading/ScanPanel";
import { tDirection, tExitReason, tOrderStatus, tPositionStatus } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function PaperTradingPage() {
  const [openPositions, closedTrades, recentOrders, account] = await Promise.all([
    prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } }, include: { asset: true, strategyVersion: { include: { strategy: true } } }, orderBy: { openedAt: "desc" } }),
    prisma.trade.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { closedAt: "desc" }, take: 15, include: { asset: true, strategyVersion: { include: { strategy: true } } } }),
    prisma.paperOrder.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { createdAt: "desc" }, take: 20, include: { asset: true } }),
    prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } }),
  ]);

  const marketProvider = getMarketDataProvider();
  const openWithLive = await Promise.all(
    openPositions.map(async (p) => {
      const latest = await marketProvider.getLatestPrice(p.asset.symbol);
      const currentPrice = latest?.price ?? p.entryPrice;
      const sign = p.direction === "LONG" ? 1 : -1;
      const unrealizedPnl = sign * (currentPrice - p.entryPrice) * p.remainingQuantity;
      const unrealizedPnlPct = p.entryPrice > 0 ? (sign * (currentPrice - p.entryPrice) * 100) / p.entryPrice : 0;
      const durationMs = Date.now() - p.openedAt.getTime();
      return { ...p, currentPrice, unrealizedPnl, unrealizedPnlPct, durationMs };
    })
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Positions</h1>
        <p className="mt-1 text-sm text-muted">100% simulado — nunca se envía ninguna orden real a un exchange. El bot gestiona esto solo; el escaneo manual de abajo es solo para forzar una comprobación ahora.</p>
        {account?.isTradingBlocked && (
          <div className="mt-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            El trading está actualmente BLOQUEADO: {account.blockedReason}
          </div>
        )}
      </div>

      <ScanPanel />

      <Card title="Abiertas" subtitle={`${openWithLive.length} posición(es) abierta(s)`}>
        {openWithLive.length === 0 ? (
          <p className="text-sm text-muted">No hay posiciones abiertas — el bot está esperando una oportunidad.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Activo</th>
                  <th className="py-1 pr-3">Estrategia</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entrada</th>
                  <th className="py-1 pr-3">Actual</th>
                  <th className="py-1 pr-3">P&L</th>
                  <th className="py-1 pr-3">P&L %</th>
                  <th className="py-1 pr-3">Tamaño</th>
                  <th className="py-1 pr-3">Stop</th>
                  <th className="py-1 pr-3">Objetivo</th>
                  <th className="py-1 pr-3">Duración</th>
                  <th className="py-1 pr-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {openWithLive.map((p) => (
                  <tr key={p.id} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{p.asset.symbol}</td>
                    <td className="py-1.5 pr-3 text-muted">{p.strategyVersion?.strategy.name ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={p.direction === "LONG" ? "success" : "danger"}>{tDirection(p.direction)}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{p.entryPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.currentPrice.toFixed(2)}</td>
                    <td className={`py-1.5 pr-3 font-mono ${p.unrealizedPnl >= 0 ? "text-accent" : "text-danger"}`}>
                      {p.unrealizedPnl >= 0 ? "+" : ""}
                      {p.unrealizedPnl.toFixed(2)}
                    </td>
                    <td className={`py-1.5 pr-3 font-mono ${p.unrealizedPnlPct >= 0 ? "text-accent" : "text-danger"}`}>
                      {p.unrealizedPnlPct >= 0 ? "+" : ""}
                      {p.unrealizedPnlPct.toFixed(2)}%
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-muted">{p.remainingQuantity.toFixed(4)}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.stopLoss?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.takeProfit?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-muted">{Math.round(p.durationMs / 60000)}m</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone="info">{tPositionStatus(p.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Cerradas" subtitle="Últimas 15 operaciones cerradas">
        {closedTrades.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay operaciones cerradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Activo</th>
                  <th className="py-1 pr-3">Estrategia</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entrada</th>
                  <th className="py-1 pr-3">Salida</th>
                  <th className="py-1 pr-3">P&L Neto</th>
                  <th className="py-1 pr-3">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((t) => (
                  <tr key={t.id} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{t.asset.symbol}</td>
                    <td className="py-1.5 pr-3 text-muted">{t.strategyVersion?.strategy.name ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={t.direction === "LONG" ? "success" : "danger"}>{tDirection(t.direction)}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{t.entryPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.exitPrice.toFixed(2)}</td>
                    <td className={`py-1.5 pr-3 font-mono ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>{t.netPnl.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-muted">{tExitReason(t.exitReason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Órdenes Recientes" subtitle="Incluye candidatas bloqueadas o de baja confianza — transparencia total sobre lo que NO operó y por qué">
        {recentOrders.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay órdenes.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                <div>
                  <span className="font-medium">{o.asset.symbol}</span> <Badge tone={o.direction === "LONG" ? "success" : "danger"}>{tDirection(o.direction)}</Badge>{" "}
                  <span className="text-muted">solicitada a {o.requestedPrice.toFixed(2)}</span>
                </div>
                <Badge tone={o.status === "FILLED" ? "success" : o.status === "LOW_CONFIDENCE" ? "warn" : "danger"}>{tOrderStatus(o.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
