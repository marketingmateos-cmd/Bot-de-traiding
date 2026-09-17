import { prisma } from "@/lib/db";
import { getStrategyPerformanceStats } from "@/lib/engines/strategyStats";
import { Card } from "@/components/ui/Card";
import { Badge, regimeTone } from "@/components/ui/Badge";
import { StrategyActiveToggle } from "@/components/strategies/StrategyActiveToggle";
import { tRegime, tStrategyKind } from "@/lib/i18n";
import { fromJson } from "@/lib/json";
import type { Regime } from "@/lib/engines/regime";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const versions = await prisma.strategyVersion.findMany({ include: { strategy: true }, orderBy: { createdAt: "asc" } });
  const withStats = await Promise.all(versions.map(async (v) => ({ v, stats: await getStrategyPerformanceStats(v.id) })));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Estrategias</h1>
        <p className="mt-1 text-sm text-muted">Cada estrategia está versionada; los parámetros y reglas quedan congelados por versión para que las operaciones pasadas sigan siendo reproducibles.</p>
        <p className="mt-1 text-xs text-muted">Solo las estrategias marcadas &ldquo;ACTIVA PARA EL BOT&rdquo; se evalúan en el próximo ciclo del bot autónomo — desactivar aquí no borra ni modifica ninguna versión.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {withStats.map(({ v, stats }) => (
          <Card key={v.id} title={`${v.strategy.name} — v${v.version}`} subtitle={tStrategyKind(v.strategy.kind)}>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Badge tone="info">{v.timeframe}</Badge>
              {fromJson<Regime[]>(v.recommendedRegimes, []).map((r) => (
                <Badge key={r} tone={regimeTone(r)}>{tRegime(r)}</Badge>
              ))}
            </div>
            <div className="mb-3">
              <StrategyActiveToggle strategyId={v.strategy.id} initialIsActive={v.strategy.isActive} />
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
                <div className="font-mono">{fromJson<{ feeBps: number }>(v.costModel, { feeBps: 0 }).feeBps}pb comisión</div>
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
                {JSON.stringify(fromJson(v.parameters, {}), null, 2)}
              </pre>
            </details>
          </Card>
        ))}
      </div>
    </div>
  );
}
