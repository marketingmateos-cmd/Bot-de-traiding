import { prisma } from "@/lib/db";
import { getStrategyPerformanceStats } from "@/lib/engines/strategyStats";
import { Card } from "@/components/ui/Card";
import { Badge, regimeTone } from "@/components/ui/Badge";
import { tRegime, tStrategyKind } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const versions = await prisma.strategyVersion.findMany({ include: { strategy: true }, orderBy: { createdAt: "asc" } });
  const withStats = await Promise.all(versions.map(async (v) => ({ v, stats: await getStrategyPerformanceStats(v.id) })));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Estrategias</h1>
        <p className="mt-1 text-sm text-muted">Cada estrategia está versionada; los parámetros y reglas quedan congelados por versión para que las operaciones pasadas sigan siendo reproducibles.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {withStats.map(({ v, stats }) => (
          <Card key={v.id} title={`${v.strategy.name} — v${v.version}`} subtitle={tStrategyKind(v.strategy.kind)}>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Badge tone="info">{v.timeframe}</Badge>
              {(v.recommendedRegimes as string[]).map((r) => (
                <Badge key={r} tone={regimeTone(r)}>{tRegime(r)}</Badge>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <div className="text-muted">Stop Loss</div>
                <div className="font-mono">{v.stopLossPct}%</div>
              </div>
              <div>
                <div className="text-muted">Take Profit</div>
                <div className="font-mono">{v.takeProfitPct}%</div>
              </div>
              <div>
                <div className="text-muted">Stop Dinámico</div>
                <div className="font-mono">{v.trailingStopPct ?? "—"}%</div>
              </div>
              <div>
                <div className="text-muted">Costes</div>
                <div className="font-mono">{(v.costModel as { feeBps: number }).feeBps}pb comisión</div>
              </div>
            </div>
            <div className="mt-3 border-t border-bg-border pt-3 text-xs">
              <div className="mb-1 text-muted">Rendimiento real en paper trading</div>
              <div className="flex flex-wrap gap-3 font-mono">
                <span>{stats.trades} operaciones</span>
                <span className={stats.totalNetPnl >= 0 ? "text-accent" : "text-danger"}>neto €{stats.totalNetPnl.toFixed(2)}</span>
                <span>acierto {(stats.winRate * 100).toFixed(0)}%</span>
                <span>Sharpe {stats.sharpe?.toFixed(2) ?? "—"}</span>
              </div>
            </div>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-accent">Parámetros</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 font-mono text-[11px] text-slate-300">
                {JSON.stringify(v.parameters, null, 2)}
              </pre>
            </details>
          </Card>
        ))}
      </div>
    </div>
  );
}
