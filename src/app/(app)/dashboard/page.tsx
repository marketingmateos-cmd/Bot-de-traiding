import { prisma } from "@/lib/db";
import { getSymbolAnalysis } from "@/lib/orchestrator";
import { getBudgetStatus } from "@/lib/engines/aiBudget";
import { getStrategyPerformanceStats } from "@/lib/engines/strategyStats";
import { assessEvidence } from "@/lib/engines/luckVsEdge";
import { computeDrawdown } from "@/lib/engines/riskEngine";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Badge, regimeTone, verdictTone } from "@/components/ui/Badge";
import { tDirection, tExitReason, tRegime, tSeverity } from "@/lib/i18n";
import Link from "next/link";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function DashboardPage() {
  const [account, openPositions, recentTrades, alerts, breakers, strategyVersions] = await Promise.all([
    prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } }),
    prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } }, include: { asset: true } }),
    prisma.trade.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { closedAt: "desc" }, take: 8, include: { asset: true } }),
    prisma.systemAlert.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.circuitBreaker.findMany({ where: { isTripped: true } }),
    prisma.strategyVersion.findMany({ where: { strategy: { isActive: true } }, include: { strategy: true } }),
  ]);

  const budget = await getBudgetStatus();
  const headline = await getSymbolAnalysis("BTC", "H1");

  const allTrades = await prisma.trade.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { closedAt: "asc" } });
  let running = account?.startingBalance ?? 100;
  const equityCurve = [running];
  for (const t of allTrades) {
    running += t.netPnl;
    equityCurve.push(running);
  }
  const drawdown = computeDrawdown(equityCurve);
  const wins = allTrades.filter((t) => t.netPnl > 0).length;
  const winRate = allTrades.length ? (wins / allTrades.length) * 100 : 0;
  const equity = account?.cashBalance ?? 100;
  const totalPnl = equity - (account?.startingBalance ?? 100);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todaysTrades = allTrades.filter((t) => t.closedAt >= todayStart);
  const dailyPnl = todaysTrades.reduce((s, t) => s + t.netPnl, 0);

  const leagueEntries = await Promise.all(
    strategyVersions.map(async (v) => {
      const stats = await getStrategyPerformanceStats(v.id);
      const evidence = assessEvidence(stats);
      return { name: v.strategy.name, stats, evidence };
    })
  );
  const failingStrategies = leagueEntries.filter((e) => e.stats.trades > 0 && e.stats.totalNetPnl < 0);
  const insufficientEvidenceCount = leagueEntries.filter((e) => e.evidence.evidenceLevel === "LOW").length;

  const dataQualityScores = await Promise.all(
    SUPPORTED_ASSETS.slice(0, 3).map(async (a) => (await getSymbolAnalysis(a.symbol, "H1")).dataQuality.score)
  );
  const avgDataQuality = Math.round(dataQualityScores.reduce((a, b) => a + b, 0) / dataQualityScores.length);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-100">Panel Principal</h1>
          <Badge tone="muted">MODO DEMO</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">Qué está pasando ahora mismo en el laboratorio — solo paper trading, nada aquí toca dinero real.</p>
      </div>

      {breakers.length > 0 && (
        <Card className="border-danger/40 bg-danger/5">
          <div className="flex items-center gap-2 text-sm font-semibold text-danger">Cortafuegos activado(s) — nuevas operaciones simuladas bloqueadas</div>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-300">
            {breakers.map((b) => (
              <li key={b.id}>
                <span className="font-mono">{b.name}</span>: {b.trippedReason}
              </li>
            ))}
          </ul>
          <Link href="/risk" className="mt-2 inline-block text-xs text-accent underline">
            Ir al Centro de Riesgo para resolverlo →
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Equity de la Cartera" value={`€${equity.toFixed(2)}`} sublabel={`Inicio: €${(account?.startingBalance ?? 100).toFixed(2)}`} />
        <StatTile label="P&L Total" value={`${totalPnl >= 0 ? "+" : ""}€${totalPnl.toFixed(2)}`} tone={totalPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="P&L Diario" value={`${dailyPnl >= 0 ? "+" : ""}€${dailyPnl.toFixed(2)}`} tone={dailyPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="Drawdown" value={`${drawdown.current.toFixed(1)}%`} sublabel={`Máx: ${drawdown.max.toFixed(1)}%`} tone={drawdown.current > 10 ? "negative" : "neutral"} />
        <StatTile label="Tasa de Acierto" value={`${winRate.toFixed(0)}%`} sublabel={`${allTrades.length} operaciones cerradas`} />
        <StatTile label="Posiciones Abiertas" value={openPositions.length} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Inteligencia de Mercado — BTC" subtitle={`Régimen: ${tRegime(headline.regime.regime)}`} className="lg:col-span-1">
          {headline.marketIntelligence ? (
            <>
              <div className="mb-3 font-mono text-3xl font-bold text-accent">{headline.marketIntelligence.score}<span className="text-sm text-muted">/100</span></div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={regimeTone(headline.regime.regime)}>{tRegime(headline.regime.regime)}</Badge>
                <Badge tone="muted">Confianza de Datos {headline.marketIntelligence.dataConfidence}%</Badge>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Aún no hay suficientes velas para calcularlo.</p>
          )}
          <Link href="/intelligence" className="mt-3 inline-block text-xs text-accent underline">
            Ver desglose completo →
          </Link>
        </Card>

        <Card title="¿Qué está aprendiendo el sistema?" className="lg:col-span-1">
          <ul className="flex flex-col gap-2 text-xs text-slate-300">
            <li>
              <span className="font-semibold text-slate-100">{leagueEntries.length}</span> versión(es) de estrategia activa(s) monitorizada(s).
            </li>
            <li>
              <span className="font-semibold text-warn">{insufficientEvidenceCount}</span> versión(es) de estrategia con EVIDENCIA INSUFICIENTE — ver{" "}
              <Link href="/luck-vs-edge" className="text-accent underline">Suerte vs Ventaja</Link>.
            </li>
            <li>
              <span className="font-semibold text-danger">{failingStrategies.length}</span> versión(es) de estrategia actualmente en negativo en paper trading.
            </li>
            <li>
              Calidad de datos en los activos muestreados: <span className="font-semibold text-slate-100">{avgDataQuality}/100</span>.
            </li>
          </ul>
          <Link href="/league" className="mt-3 inline-block text-xs text-accent underline">
            Liga de Estrategias →
          </Link>
        </Card>

        <Card title="Uso de IA Hoy" className="lg:col-span-1">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Llamadas Hoy" value={`${budget.callsToday}/${budget.dailyBudget}`} />
            <StatTile label="Presupuesto Restante" value={`${budget.budgetRemainingPct.toFixed(0)}%`} />
            <StatTile label="Coste Est. (mes)" value={`$${budget.monthlyCostUsd.toFixed(2)}`} />
            <StatTile label="Tasa de Acierto de Caché" value={`${(budget.cacheHitRate * 100).toFixed(0)}%`} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Posiciones Simuladas Abiertas" subtitle={`${openPositions.length} abierta(s)`}>
          {openPositions.length === 0 ? (
            <p className="text-sm text-muted">No hay posiciones abiertas.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {openPositions.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-sm">
                  <div>
                    <span className="font-semibold">{p.asset.symbol}</span>{" "}
                    <Badge tone={p.direction === "LONG" ? "success" : "danger"}>{tDirection(p.direction)}</Badge>
                  </div>
                  <div className="font-mono text-xs text-muted">entrada {p.entryPrice.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
          <Link href="/paper-trading" className="mt-3 inline-block text-xs text-accent underline">
            Ir a Paper Trading →
          </Link>
        </Card>

        <Card title="Alertas Recientes">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">Aún no hay alertas.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-xs">
                  <Badge tone={verdictTone(a.severity)}>{tSeverity(a.severity)}</Badge>
                  <div>
                    <div className="font-medium text-slate-200">{a.title}</div>
                    <div className="text-muted">{a.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Operaciones Recientes">
        {recentTrades.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay operaciones cerradas. Ejecuta un escaneo en Paper Trading para generar actividad.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Activo</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entrada</th>
                  <th className="py-1 pr-3">Salida</th>
                  <th className="py-1 pr-3">P&L Neto</th>
                  <th className="py-1 pr-3">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t) => (
                  <tr key={t.id} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{t.asset.symbol}</td>
                    <td className="py-1.5 pr-3">{tDirection(t.direction)}</td>
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
        <Link href="/journal" className="mt-3 inline-block text-xs text-accent underline">
          Ver Diario de Operaciones completo →
        </Link>
      </Card>
    </div>
  );
}
