import { prisma } from "@/lib/db";
import { getStrategyPerformanceStats } from "@/lib/engines/strategyStats";
import { rankStrategies } from "@/lib/engines/strategyLeague";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function LeaguePage() {
  const versions = await prisma.strategyVersion.findMany({ include: { strategy: true } });

  const entries = await Promise.all(
    versions.map(async (v) => {
      const stats = await getStrategyPerformanceStats(v.id);
      const latestRobustness = await prisma.backtest.findFirst({
        where: { strategyVersionId: v.id, kind: "ROBUSTNESS" },
        orderBy: { createdAt: "desc" },
      });
      const summary = latestRobustness?.summary as { robustness?: { score: number } } | null;
      return {
        strategyVersionId: v.id,
        strategyName: `${v.strategy.name} v${v.version}`,
        version: v.version,
        stats,
        robustnessScore: summary?.robustness?.score ?? null,
        oosSharpe: null,
        benchmarkReturnPct: null,
      };
    })
  );

  const ranked = rankStrategies(entries);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Liga de Estrategias</h1>
        <p className="mt-1 text-sm text-muted">Clasificada por una puntuación compuesta (Sharpe, Sortino, drawdown, robustez, OOS, tamaño de muestra) — NO por el retorno bruto.</p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1.5 pr-3">Puesto</th>
                <th className="py-1.5 pr-3">Estrategia</th>
                <th className="py-1.5 pr-3">Operaciones</th>
                <th className="py-1.5 pr-3">P&L Neto</th>
                <th className="py-1.5 pr-3">Sharpe</th>
                <th className="py-1.5 pr-3">DD Máx</th>
                <th className="py-1.5 pr-3">Robustez</th>
                <th className="py-1.5 pr-3">Compuesta</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((e) => (
                <tr key={e.strategyVersionId} className="border-t border-bg-border">
                  <td className="py-1.5 pr-3 font-mono">#{e.rank}</td>
                  <td className="py-1.5 pr-3 font-medium">{e.strategyName}</td>
                  <td className="py-1.5 pr-3">{e.stats.trades}</td>
                  <td className={`py-1.5 pr-3 font-mono ${e.stats.totalNetPnl >= 0 ? "text-accent" : "text-danger"}`}>€{e.stats.totalNetPnl.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{e.stats.sharpe?.toFixed(2) ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-mono">{e.stats.maxDrawdownPct.toFixed(1)}%</td>
                  <td className="py-1.5 pr-3">{e.robustnessScore !== null ? `${e.robustnessScore}/100` : <Badge tone="muted">sin probar</Badge>}</td>
                  <td className="py-1.5 pr-3 font-mono font-semibold text-accent">{e.compositeScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
