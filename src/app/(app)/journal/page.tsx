import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { Badge, verdictTone } from "@/components/ui/Badge";
import { tDirection, tExitReason, tPostMortem } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function JournalPage() {
  const trades = await prisma.trade.findMany({
    where: { accountId: ACCOUNT_ID },
    orderBy: { closedAt: "desc" },
    take: 40,
    include: { asset: true, strategyVersion: { include: { strategy: true } }, journal: { include: { postMortem: true } } },
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Diario de Operaciones</h1>
        <p className="mt-1 text-sm text-muted">Cada operación cerrada con su instantánea completa de reproducibilidad y su clasificación automática de post-mortem.</p>
      </div>

      {trades.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Aún no hay operaciones. Ejecuta un escaneo en Paper Trading y deja que las posiciones alcancen su stop/objetivo.</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {trades.map((t) => (
          <Card key={t.id} className="!p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-slate-100">{t.asset.symbol}</span>
                <Badge tone={t.direction === "LONG" ? "success" : "danger"}>{tDirection(t.direction)}</Badge>
                <span className="text-muted">{t.strategyVersion?.strategy.name ?? "—"}</span>
              </div>
              <div className={`font-mono text-sm ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>
                {t.netPnl >= 0 ? "+" : ""}€{t.netPnl.toFixed(2)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <div className="text-muted">Entrada / Salida</div>
                <div className="font-mono">{t.entryPrice.toFixed(2)} → {t.exitPrice.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted">Comisiones / Slippage</div>
                <div className="font-mono">€{t.fees.toFixed(3)} / €{t.slippageCost.toFixed(3)}</div>
              </div>
              <div>
                <div className="text-muted">MAE / MFE</div>
                <div className="font-mono">{(t.mae * 100).toFixed(2)}% / {(t.mfe * 100).toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-muted">Duración</div>
                <div className="font-mono">{Math.round(t.durationSeconds / 60)}m</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="muted">Salida: {tExitReason(t.exitReason)}</Badge>
              {t.journal?.postMortem && (
                <Badge tone={verdictTone(t.journal.postMortem.classification)}>{tPostMortem(t.journal.postMortem.classification)}</Badge>
              )}
            </div>
            {t.journal?.postMortem && <p className="mt-2 text-xs text-muted">{t.journal.postMortem.notes}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
