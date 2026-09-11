import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScanPanel } from "@/components/paper-trading/ScanPanel";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function PaperTradingPage() {
  const [openPositions, recentOrders, account] = await Promise.all([
    prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } }, include: { asset: true, strategyVersion: { include: { strategy: true } } } }),
    prisma.paperOrder.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { createdAt: "desc" }, take: 20, include: { asset: true } }),
    prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Paper Trading</h1>
        <p className="mt-1 text-sm text-muted">100% simulated — no real orders are ever sent to any exchange. Long and short both supported.</p>
        {account?.isTradingBlocked && (
          <div className="mt-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            Trading is currently BLOCKED: {account.blockedReason}
          </div>
        )}
      </div>

      <ScanPanel />

      <Card title="Open Positions" subtitle={`${openPositions.length} open`}>
        {openPositions.length === 0 ? (
          <p className="text-sm text-muted">No open positions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Asset</th>
                  <th className="py-1 pr-3">Strategy</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entry</th>
                  <th className="py-1 pr-3">Stop</th>
                  <th className="py-1 pr-3">Target</th>
                  <th className="py-1 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p) => (
                  <tr key={p.id} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{p.asset.symbol}</td>
                    <td className="py-1.5 pr-3">{p.strategyVersion?.strategy.name ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={p.direction === "LONG" ? "success" : "danger"}>{p.direction}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{p.entryPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.stopLoss?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.takeProfit?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone="info">{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recent Orders" subtitle="Includes blocked / low-confidence candidates — full transparency on what did NOT trade and why">
        {recentOrders.length === 0 ? (
          <p className="text-sm text-muted">No orders yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                <div>
                  <span className="font-medium">{o.asset.symbol}</span> <Badge tone={o.direction === "LONG" ? "success" : "danger"}>{o.direction}</Badge>{" "}
                  <span className="text-muted">requested @ {o.requestedPrice.toFixed(2)}</span>
                </div>
                <Badge tone={o.status === "FILLED" ? "success" : o.status === "LOW_CONFIDENCE" ? "warn" : "danger"}>{o.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
