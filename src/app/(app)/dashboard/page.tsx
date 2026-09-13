import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { ensureBotConfig } from "@/lib/botLoop";
import { riskPresetForLevel } from "@/lib/engines/riskEngine";
import { computeDrawdown } from "@/lib/engines/riskEngine";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Badge, verdictTone } from "@/components/ui/Badge";
import { BotStatusCard } from "@/components/dashboard/BotStatusCard";
import { RiskLevelSlider } from "@/components/settings/RiskProfileForm";
import { tDirection, tExitReason, tRiskProfile } from "@/lib/i18n";
import { fromJson } from "@/lib/json";
import type { AIAnalystOutput } from "@/lib/providers/types";
import Link from "next/link";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";

export default async function DashboardPage() {
  const [account, openPositions, recentTrades, alerts, breakers, assets, botConfig] = await Promise.all([
    prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } }),
    prisma.paperPosition.findMany({
      where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } },
      include: { asset: true, strategyVersion: { include: { strategy: true } } },
      orderBy: { openedAt: "desc" },
    }),
    prisma.trade.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { closedAt: "desc" }, take: 6, include: { asset: true } }),
    prisma.systemAlert.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.circuitBreaker.findMany({ where: { isTripped: true } }),
    prisma.asset.findMany({ where: { isActive: true } }),
    ensureBotConfig(),
  ]);

  const marketProvider = getMarketDataProvider();
  const positionsWithLive = await Promise.all(
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

  const allTrades = await prisma.trade.findMany({ where: { accountId: ACCOUNT_ID }, orderBy: { closedAt: "asc" } });
  let running = account?.startingBalance ?? 100;
  const equityCurve = [running];
  for (const t of allTrades) {
    running += t.netPnl;
    equityCurve.push(running);
  }
  const drawdown = computeDrawdown(equityCurve);
  const realizedPnl = (account?.cashBalance ?? 100) - (account?.startingBalance ?? 100);
  const unrealizedPnl = positionsWithLive.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const equity = (account?.cashBalance ?? 100) + unrealizedPnl;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todaysTrades = allTrades.filter((t) => t.closedAt >= todayStart);
  const todayRealizedPnl = todaysTrades.reduce((s, t) => s + t.netPnl, 0);
  const todayPnl = todayRealizedPnl + unrealizedPnl;
  const todayWins = todaysTrades.filter((t) => t.netPnl > 0).length;
  const todayWinRate = todaysTrades.length ? (todayWins / todaysTrades.length) * 100 : 0;

  const riskLevel = account?.riskLevel ?? 5;

  const recentAnalyses = await prisma.aIAnalysis.findMany({
    where: { kind: "ANALYST" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const opportunities: { symbol: string; direction: string; confidence: number; reason: string }[] = [];
  for (const a of recentAnalyses) {
    const output = fromJson<AIAnalystOutput | null>(a.output, null);
    if (!output || output.signal === "FLAT" || !a.assetId) continue;
    const asset = assetById.get(a.assetId);
    if (!asset) continue;
    const key = `${asset.symbol}:${a.strategyVersionId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    opportunities.push({
      symbol: asset.symbol,
      direction: output.signal,
      confidence: Math.round(output.confidence * 100),
      reason: output.reasons[0] ?? "",
    });
    if (opportunities.length >= 5) break;
  }

  const assetClassCounts = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.assetClass] = (acc[a.assetClass] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-100">AI Trading Bot Lab</h1>
          <Badge tone="muted">MODO DEMO — solo paper trading</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">Qué está haciendo el bot ahora mismo, en una sola pantalla.</p>
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
            Ir al Centro de Riesgo →
          </Link>
        </Card>
      )}

      <BotStatusCard marketsMonitored={assets.length} />

      <Card
        title="Risk Level"
        subtitle="Editable directamente aquí — se aplica a partir del próximo escaneo, sin ir a Ajustes"
      >
        <RiskLevelSlider accountId={ACCOUNT_ID} current={riskLevel} />
      </Card>

      <Card
        title="Today"
        actions={
          <Link href="/journal" className="rounded border border-bg-border px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
            VIEW JOURNAL
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="P&L" value={`${todayPnl >= 0 ? "+" : ""}€${todayPnl.toFixed(2)}`} tone={todayPnl >= 0 ? "positive" : "negative"} />
          <StatTile label="Trades" value={todaysTrades.length} />
          <StatTile label="Win Rate" value={todaysTrades.length ? `${todayWinRate.toFixed(0)}%` : "—"} />
          <StatTile label="Drawdown" value={`${drawdown.current.toFixed(1)}%`} tone={drawdown.current > 10 ? "negative" : "neutral"} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Equity" value={`€${equity.toFixed(2)}`} sublabel={`Inicio: €${(account?.startingBalance ?? 100).toFixed(2)}`} />
        <StatTile label="P&L Hoy" value={`${todayPnl >= 0 ? "+" : ""}€${todayPnl.toFixed(2)}`} tone={todayPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="P&L Total" value={`${totalPnl >= 0 ? "+" : ""}€${totalPnl.toFixed(2)}`} tone={totalPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="No Realizado" value={`${unrealizedPnl >= 0 ? "+" : ""}€${unrealizedPnl.toFixed(2)}`} tone={unrealizedPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="Posiciones Abiertas" value={openPositions.length} />
        <StatTile label="Risk Level" value={`${riskLevel}/10`} sublabel={tRiskProfile(riskPresetForLevel(riskLevel))} />
      </div>

      <Card
        title="Posiciones Abiertas"
        subtitle={`${positionsWithLive.length} abierta(s)`}
        actions={
          <Link href="/paper-trading" className="text-xs text-accent underline">
            Ver todas →
          </Link>
        }
      >
        {positionsWithLive.length === 0 ? (
          <p className="text-sm text-muted">No hay posiciones abiertas — el bot está esperando una oportunidad.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Activo</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entrada</th>
                  <th className="py-1 pr-3">Actual</th>
                  <th className="py-1 pr-3">P&L</th>
                  <th className="py-1 pr-3">P&L %</th>
                  <th className="py-1 pr-3">Duración</th>
                  <th className="py-1 pr-3">Estrategia</th>
                </tr>
              </thead>
              <tbody>
                {positionsWithLive.map((p) => (
                  <tr key={p.id} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{p.asset.symbol}</td>
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
                    <td className="py-1.5 pr-3 text-muted">{Math.round(p.durationMs / 60000)}m</td>
                    <td className="py-1.5 pr-3 text-muted">{p.strategyVersion?.strategy.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Top Opportunities" subtitle="Lo que el bot está viendo — no se abre nada manualmente aquí">
          {opportunities.length === 0 ? (
            <p className="text-sm text-muted">Sin señales recientes.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {opportunities.map((o, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                  <div>
                    <span className="font-medium">{o.symbol}</span> <Badge tone={o.direction === "LONG" ? "success" : "danger"}>{tDirection(o.direction)}</Badge>
                    <div className="mt-0.5 text-muted">{o.reason}</div>
                  </div>
                  <span className="font-mono text-slate-200">{o.confidence}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Mercados">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Crypto</span>
              <span className="font-mono text-slate-100">{assetClassCounts.CRYPTO ?? 0} activos</span>
            </div>
            <div className="flex items-center justify-between text-muted">
              <span>Forex</span>
              <span className="font-mono">{assetClassCounts.FOREX ?? 0} activos (próximamente)</span>
            </div>
            <div className="flex items-center justify-between text-muted">
              <span>Metals</span>
              <span className="font-mono">{assetClassCounts.METALS ?? 0} activos (próximamente)</span>
            </div>
          </div>
          <Link href="/markets" className="mt-3 inline-block text-xs text-accent underline">
            Ver mercados →
          </Link>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Actividad del Bot">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">Aún no hay actividad.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-xs">
                  <span className="whitespace-nowrap font-mono text-muted">
                    {a.createdAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Badge tone={verdictTone(a.severity)}>{a.severity}</Badge>
                  <div>
                    <div className="font-medium text-slate-200">{a.title}</div>
                    <div className="text-muted">{a.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Riesgo Actual" subtitle="Drawdown y evolución de la cuenta">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Drawdown" value={`${drawdown.current.toFixed(1)}%`} sublabel={`Máx: ${drawdown.max.toFixed(1)}%`} tone={drawdown.current > 10 ? "negative" : "neutral"} />
            <StatTile label="Operaciones Cerradas" value={allTrades.length} />
          </div>
          <Link href="/risk" className="mt-3 inline-block text-xs text-accent underline">
            Centro de Riesgo completo →
          </Link>
        </Card>
      </div>

      <Card title="Operaciones Recientes">
        {recentTrades.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay operaciones cerradas.</p>
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
