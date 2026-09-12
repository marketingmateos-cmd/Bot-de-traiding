import Link from "next/link";
import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { computeBuyAndHold } from "@/lib/engines/benchmark";
import { computeTradeStats } from "@/lib/engines/strategyStats";
import { assessEvidence } from "@/lib/engines/luckVsEdge";
import {
  bestWorstDays,
  bestWorstTrade,
  computeDailyStats,
  computeDayOfWeekStats,
  computeDrawdownWithDuration,
  computeStreaks,
  groupPerformance,
  type JournalTradeLike,
} from "@/lib/engines/journal";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Badge, verdictTone } from "@/components/ui/Badge";
import { EquityRangeChart } from "@/components/journal/EquityRangeChart";
import { JournalCalendar, type CalendarDay, type CalendarDayTrade } from "@/components/journal/JournalCalendar";
import { JournalExportButton, type ExportRow } from "@/components/journal/JournalExportButton";
import { tDirection, tExitReason } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const ACCOUNT_ID = "main-paper-account";
const MIN_TRADES_FOR_STATS = 5;

function toJournalTrade(t: {
  id: string;
  closedAt: Date;
  openedAt: Date;
  netPnl: number;
  entryPrice: number;
  quantity: number;
  direction: string;
  exitReason: string;
  asset: { symbol: string; assetClass: string };
  strategyVersion: { strategy: { name: string } } | null;
  strategyVersionId: string | null;
}): JournalTradeLike {
  return {
    id: t.id,
    closedAt: t.closedAt,
    openedAt: t.openedAt,
    netPnl: t.netPnl,
    entryPrice: t.entryPrice,
    quantity: t.quantity,
    direction: t.direction,
    exitReason: t.exitReason,
    assetSymbol: t.asset.symbol,
    assetClass: t.asset.assetClass,
    strategyName: t.strategyVersion?.strategy.name ?? "—",
    strategyVersionId: t.strategyVersionId,
  };
}

function riskBucketLabel(level: number): string {
  if (level <= 3) return "Risk 1-3";
  if (level <= 6) return "Risk 4-6";
  if (level <= 8) return "Risk 7-8";
  return "Risk 9-10";
}

export default async function JournalPage() {
  const [account, tradesRaw, openPositions] = await Promise.all([
    prisma.paperAccount.findUnique({ where: { id: ACCOUNT_ID } }),
    prisma.trade.findMany({
      where: { accountId: ACCOUNT_ID },
      orderBy: { closedAt: "asc" },
      include: { asset: true, strategyVersion: { include: { strategy: true } } },
    }),
    prisma.paperPosition.findMany({ where: { accountId: ACCOUNT_ID, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } }, include: { asset: true } }),
  ]);

  const startingBalance = account?.startingBalance ?? 100;
  const trades = tradesRaw.map(toJournalTrade);

  if (trades.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Journal</h1>
          <p className="mt-1 text-sm text-muted">Diario de trading — día a día, semana a semana, mes a mes.</p>
        </div>
        <Card>
          <p className="text-sm text-muted">
            <Badge tone="muted">INSUFFICIENT DATA</Badge> Aún no hay operaciones cerradas. En cuanto el bot cierre su primera
            posición simulada, este diario empieza a llenarse con datos reales — nunca con estadísticas inventadas.
          </p>
        </Card>
      </div>
    );
  }

  // Live current-price fetch — same approach as Dashboard/Portfolio, so
  // "today's" equity always agrees across every screen (spec §28).
  const marketProvider = getMarketDataProvider();
  const livePrices = await Promise.all(openPositions.map((p) => marketProvider.getLatestPrice(p.asset.symbol)));
  const unrealizedPnl = openPositions.reduce((sum, p, i) => {
    const currentPrice = livePrices[i]?.price ?? p.entryPrice;
    const sign = p.direction === "LONG" ? 1 : -1;
    return sum + sign * (currentPrice - p.entryPrice) * p.remainingQuantity;
  }, 0);
  const equity = (account?.cashBalance ?? startingBalance) + unrealizedPnl;

  const daily = computeDailyStats(trades, startingBalance);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayStat = daily.find((d) => d.date === todayKey) ?? null;

  const equitySeries = [
    { t: new Date(daily[0].date).getTime() - 86_400_000, equity: startingBalance },
    ...daily.map((d) => ({ t: new Date(d.date).getTime(), equity: d.endingBalance })),
  ];

  const streaks = computeStreaks(trades);
  const dayOfWeek = computeDayOfWeekStats(trades);
  const { best: bestDays, worst: worstDays } = bestWorstDays(daily, 5);
  const { best: bestTrade, worst: worstTrade } = bestWorstTrade(tradesRaw);
  const drawdown = computeDrawdownWithDuration(daily);
  const overallStats = computeTradeStats(trades);
  const evidence = assessEvidence(overallStats);

  const strategyPerf = groupPerformance(
    trades,
    (t) => t.strategyVersionId ?? "none",
    (key) => trades.find((t) => (t.strategyVersionId ?? "none") === key)?.strategyName ?? "—"
  );
  const assetPerf = groupPerformance(
    trades,
    (t) => t.assetSymbol,
    (key) => key
  );
  const directionPerf = groupPerformance(
    trades,
    (t) => t.direction,
    (key) => tDirection(key)
  );
  const riskTrades = tradesRaw.filter((t) => t.riskLevelAtEntry !== null).map((t) => ({ ...toJournalTrade(t), riskLevel: t.riskLevelAtEntry! }));
  const riskPerf = groupPerformance(
    riskTrades,
    (t) => riskBucketLabel(t.riskLevel),
    (key) => key
  );

  // Benchmark: bot's realized return over the same window vs Buy & Hold on
  // the account's primary asset (spec §30) — never hidden even when the bot
  // underperforms.
  const primaryAssetSymbol = assetPerf[0]?.key ?? "BTC";
  const daysSpanned = Math.max(1, Math.min(365, daily.length + 5));
  const benchmarkBars = await marketProvider.getOHLCV(primaryAssetSymbol, "D1", daysSpanned);
  const benchmark = computeBuyAndHold(benchmarkBars.bars);
  const botReturnPct = ((equity - startingBalance) / startingBalance) * 100;
  const botBeatsBenchmark = botReturnPct > benchmark.totalReturnPct;

  const calendarDays: CalendarDay[] = daily.map((d) => ({ date: d.date, pnl: d.pnl, trades: d.trades }));
  const tradesByDay: Record<string, CalendarDayTrade[]> = {};
  for (const t of tradesRaw) {
    const key = t.closedAt.toISOString().slice(0, 10);
    if (!tradesByDay[key]) tradesByDay[key] = [];
    const sign = t.direction === "LONG" ? 1 : -1;
    tradesByDay[key].push({
      id: t.id,
      time: t.closedAt.toISOString().slice(11, 16),
      assetSymbol: t.asset.symbol,
      direction: t.direction,
      strategyName: t.strategyVersion?.strategy.name ?? "—",
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      netPnl: t.netPnl,
      pnlPct: (sign * (t.exitPrice - t.entryPrice) * 100) / t.entryPrice,
      durationMinutes: Math.round(t.durationSeconds / 60),
      exitReason: t.exitReason,
    });
  }

  const exportRows: ExportRow[] = tradesRaw.map((t) => {
    const sign = t.direction === "LONG" ? 1 : -1;
    return {
      date: t.closedAt.toISOString().slice(0, 10),
      time: t.closedAt.toISOString().slice(11, 16),
      asset: t.asset.symbol,
      direction: t.direction,
      strategy: t.strategyVersion?.strategy.name ?? "—",
      entry: t.entryPrice,
      exit: t.exitPrice,
      pnl: t.netPnl,
      pnlPct: (sign * (t.exitPrice - t.entryPrice) * 100) / t.entryPrice,
      riskLevel: t.riskLevelAtEntry ?? 0,
      result: t.netPnl >= 0 ? "WIN" : "LOSS",
      durationMinutes: Math.round(t.durationSeconds / 60),
      fees: t.fees,
      slippage: t.slippageCost,
    };
  });

  // Daily review — plain sentences generated from real stored numbers only (spec §24/§26), never invented.
  const dailyReview = todayStat
    ? (() => {
        const byStratToday = groupPerformance(
          trades.filter((t) => t.closedAt.toISOString().slice(0, 10) === todayKey),
          (t) => t.strategyName,
          (k) => k
        );
        const bestStrat = byStratToday[0];
        const worstStrat = byStratToday[byStratToday.length - 1];
        const lines = [
          `Hoy el bot ejecutó ${todayStat.trades} operación(es) de paper trading.`,
          `${todayStat.wins} ganadora(s), ${todayStat.losses} perdedora(s). P&L neto: ${todayStat.pnl >= 0 ? "+" : ""}€${todayStat.pnl.toFixed(2)}.`,
        ];
        if (bestStrat) lines.push(`Mejor estrategia hoy: ${bestStrat.label} (${bestStrat.stats.totalNetPnl >= 0 ? "+" : ""}€${bestStrat.stats.totalNetPnl.toFixed(2)}).`);
        if (worstStrat && worstStrat.label !== bestStrat?.label) {
          lines.push(`Peor estrategia hoy: ${worstStrat.label} (${worstStrat.stats.totalNetPnl >= 0 ? "+" : ""}€${worstStrat.stats.totalNetPnl.toFixed(2)}).`);
        }
        lines.push(account?.isTradingBlocked ? "El trading está bloqueado — revisa el Centro de Riesgo." : "El bot se mantuvo dentro de sus límites de riesgo.");
        return lines;
      })()
    : ["Sin operaciones registradas hoy todavía."];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Journal</h1>
          <p className="mt-1 text-sm text-muted">Diario de trading — día a día, semana a semana, mes a mes. Solo paper trading.</p>
        </div>
        <JournalExportButton rows={exportRows} filenamePrefix="trading-journal" />
      </div>

      <Card title="Today">
        {todayStat ? (
          <>
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-sm text-muted">€{todayStat.startingBalance.toFixed(2)}</span>
              <span className="text-muted">→</span>
              <span className="font-mono text-lg font-semibold text-slate-100">€{equity.toFixed(2)}</span>
              <span className="text-[11px] text-muted">Equity ahora mismo — igual que en Dashboard/Portfolio</span>
            </div>
            <div className="mb-3 text-xs text-muted">
              Realizado hoy: <span className={todayStat.pnl >= 0 ? "text-accent" : "text-danger"}>
                {todayStat.pnl >= 0 ? "+" : ""}€{todayStat.pnl.toFixed(2)} ({todayStat.pnlPct >= 0 ? "+" : ""}
                {todayStat.pnlPct.toFixed(2)}%)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <StatTile label="Trades" value={todayStat.trades} />
              <StatTile label="Wins" value={todayStat.wins} tone="positive" />
              <StatTile label="Losses" value={todayStat.losses} tone="negative" />
              <StatTile label="Win Rate" value={`${todayStat.winRate.toFixed(1)}%`} />
              <StatTile label="Avg Win" value={`€${todayStat.avgWin.toFixed(2)}`} />
              <StatTile label="Avg Loss" value={`€${todayStat.avgLoss.toFixed(2)}`} />
              <StatTile label="Profit Factor" value={todayStat.profitFactor === null ? "—" : todayStat.profitFactor.toFixed(2)} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Sin operaciones cerradas hoy todavía — WAITING FOR OPPORTUNITY.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Calendario">
          <JournalCalendar days={calendarDays} tradesByDay={tradesByDay} />
        </Card>
        <Card title="Daily Review" subtitle="Generado a partir de datos reales — nunca conclusiones inventadas">
          <ul className="flex flex-col gap-1.5 text-sm text-slate-300">
            {dailyReview.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Evidence Level:</span>
            <Badge tone={evidence.evidenceLevel === "HIGH" ? "success" : evidence.evidenceLevel === "MEDIUM" ? "warn" : "danger"}>{evidence.evidenceLevel}</Badge>
            <span className="text-xs text-muted">({overallStats.trades} operaciones totales)</span>
          </div>
        </Card>
      </div>

      <Card title="Equity Curve">
        <EquityRangeChart series={equitySeries} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Streaks">
          <div className="grid grid-cols-1 gap-3">
            <StatTile
              label="Current Streak"
              value={streaks.currentType ? `${streaks.currentCount} ${streaks.currentType === "WIN" ? "wins" : "losses"}` : "—"}
              tone={streaks.currentType === "WIN" ? "positive" : streaks.currentType === "LOSS" ? "negative" : "neutral"}
            />
            <StatTile label="Best Streak" value={`${streaks.bestWinStreak} wins`} tone="positive" />
            <StatTile label="Worst Streak" value={`${streaks.worstLossStreak} losses`} tone="negative" />
          </div>
        </Card>

        <Card title="Drawdown">
          <div className="grid grid-cols-1 gap-3">
            <StatTile label="Current Drawdown" value={`${drawdown.current.toFixed(1)}%`} sublabel={`${drawdown.currentDurationDays} día(s)`} tone={drawdown.current > 0 ? "negative" : "neutral"} />
            <StatTile label="Max Drawdown" value={`${drawdown.max.toFixed(1)}%`} sublabel={`Duración máx: ${drawdown.maxDurationDays} día(s)`} />
          </div>
        </Card>

        <Card title="Bot vs Buy & Hold" subtitle={`Benchmark: ${primaryAssetSymbol}`}>
          <div className="grid grid-cols-1 gap-3">
            <StatTile label="Bot" value={`${botReturnPct >= 0 ? "+" : ""}${botReturnPct.toFixed(1)}%`} tone={botReturnPct >= 0 ? "positive" : "negative"} />
            <StatTile label={`${primaryAssetSymbol} Buy & Hold`} value={`${benchmark.totalReturnPct >= 0 ? "+" : ""}${benchmark.totalReturnPct.toFixed(1)}%`} />
          </div>
          <p className={`mt-2 text-xs ${botBeatsBenchmark ? "text-accent" : "text-danger"}`}>
            {botBeatsBenchmark ? "Bot outperformed benchmark" : "Bot underperformed benchmark"}
          </p>
        </Card>
      </div>

      {(bestTrade || worstTrade) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {bestTrade && (
            <Card title="Best Trade" className="border-accent/20">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {bestTrade.asset?.symbol ?? tradesRaw.find((t) => t.id === bestTrade.id)?.asset.symbol}
                </span>
                <span className="font-mono text-accent">+€{bestTrade.netPnl.toFixed(2)}</span>
              </div>
            </Card>
          )}
          {worstTrade && (
            <Card title="Worst Trade" className="border-danger/20">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {worstTrade.asset?.symbol ?? tradesRaw.find((t) => t.id === worstTrade.id)?.asset.symbol}
                </span>
                <span className="font-mono text-danger">€{worstTrade.netPnl.toFixed(2)}</span>
              </div>
            </Card>
          )}
        </div>
      )}

      <Card title="Best Days / Worst Days">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Best Days</div>
            <div className="flex flex-col gap-1">
              {bestDays.map((d) => (
                <div key={d.date} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{d.date}</span>
                  <span className="font-mono text-accent">+€{d.pnl.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Worst Days</div>
            <div className="flex flex-col gap-1">
              {worstDays.map((d) => (
                <div key={d.date} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{d.date}</span>
                  <span className={`font-mono ${d.pnl >= 0 ? "text-accent" : "text-danger"}`}>
                    {d.pnl >= 0 ? "+" : ""}€{d.pnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card title="P&L por día de la semana" subtitle="No se asume ningún patrón — solo se muestra lo que hay">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3">Día</th>
                <th className="py-1 pr-3">Trades</th>
                <th className="py-1 pr-3">Win Rate</th>
                <th className="py-1 pr-3">Avg P&L</th>
                <th className="py-1 pr-3">Total P&L</th>
              </tr>
            </thead>
            <tbody>
              {dayOfWeek.map((d) => (
                <tr key={d.label} className="border-t border-bg-border">
                  <td className="py-1.5 pr-3 font-medium">{d.label}</td>
                  <td className="py-1.5 pr-3 text-muted">{d.trades}</td>
                  <td className="py-1.5 pr-3 text-muted">{d.trades ? `${d.winRate.toFixed(0)}%` : "—"}</td>
                  <td className="py-1.5 pr-3 font-mono text-muted">{d.trades ? `€${d.avgPnl.toFixed(2)}` : "—"}</td>
                  <td className={`py-1.5 pr-3 font-mono ${d.totalPnl >= 0 ? "text-accent" : "text-danger"}`}>{d.trades ? `${d.totalPnl >= 0 ? "+" : ""}€${d.totalPnl.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Strategy Performance">
          {strategyPerf.length < 1 ? (
            <p className="text-sm text-muted">INSUFFICIENT DATA</p>
          ) : (
            <div className="flex flex-col gap-2">
              {strategyPerf.map((s) => (
                <div key={s.key} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                  <div>
                    <div className="font-medium text-slate-200">{s.label}</div>
                    <div className="text-muted">{s.stats.trades} trades · {(s.stats.winRate * 100).toFixed(0)}% WR</div>
                  </div>
                  <span className={`font-mono ${s.stats.totalNetPnl >= 0 ? "text-accent" : "text-danger"}`}>
                    {s.stats.totalNetPnl >= 0 ? "+" : ""}€{s.stats.totalNetPnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Asset Performance">
          <div className="flex flex-col gap-2">
            {assetPerf.map((a) => (
              <div key={a.key} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                <div>
                  <div className="font-medium text-slate-200">{a.label}</div>
                  <div className="text-muted">{a.stats.trades} trades · {(a.stats.winRate * 100).toFixed(0)}% WR</div>
                </div>
                <span className={`font-mono ${a.stats.totalNetPnl >= 0 ? "text-accent" : "text-danger"}`}>
                  {a.stats.totalNetPnl >= 0 ? "+" : ""}€{a.stats.totalNetPnl.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Long vs Short">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {directionPerf.map((d) => (
              <div key={d.key} className="rounded border border-bg-border bg-black/20 p-3 text-xs">
                <Badge tone={d.key === "LONG" ? "success" : "danger"}>{d.label}</Badge>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-muted">Trades</div>
                    <div className="font-mono text-slate-100">{d.stats.trades}</div>
                  </div>
                  <div>
                    <div className="text-muted">Win Rate</div>
                    <div className="font-mono text-slate-100">{(d.stats.winRate * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div className="text-muted">P&L</div>
                    <div className={`font-mono ${d.stats.totalNetPnl >= 0 ? "text-accent" : "text-danger"}`}>€{d.stats.totalNetPnl.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Profit Factor</div>
                    <div className="font-mono text-slate-100">{d.stats.profitFactor?.toFixed(2) ?? "—"}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Risk Performance" subtitle="¿Aumentar el riesgo mejora los resultados, o solo la volatilidad?">
          {riskPerf.length === 0 ? (
            <p className="text-sm text-muted">INSUFFICIENT DATA — ninguna operación registrada tiene el nivel de riesgo asociado todavía.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {riskPerf.map((r) => (
                <div key={r.key} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                  <div>
                    <div className="font-medium text-slate-200">{r.label}</div>
                    <div className="text-muted">{r.stats.trades} trades · {(r.stats.winRate * 100).toFixed(0)}% WR</div>
                  </div>
                  <span className={`font-mono ${r.stats.totalNetPnl >= 0 ? "text-accent" : "text-danger"}`}>
                    {r.stats.totalNetPnl >= 0 ? "+" : ""}€{r.stats.totalNetPnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Daily Performance" subtitle="Más reciente primero">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3">Fecha</th>
                <th className="py-1 pr-3">Inicio</th>
                <th className="py-1 pr-3">Fin</th>
                <th className="py-1 pr-3">P&L</th>
                <th className="py-1 pr-3">P&L %</th>
                <th className="py-1 pr-3">Trades</th>
                <th className="py-1 pr-3">Wins</th>
                <th className="py-1 pr-3">Losses</th>
                <th className="py-1 pr-3">Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date} className="border-t border-bg-border">
                  <td className="py-1.5 pr-3 font-medium">{d.date}</td>
                  <td className="py-1.5 pr-3 font-mono text-muted">€{d.startingBalance.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">€{d.endingBalance.toFixed(2)}</td>
                  <td className={`py-1.5 pr-3 font-mono ${d.pnl >= 0 ? "text-accent" : "text-danger"}`}>
                    {d.pnl >= 0 ? "+" : ""}€{d.pnl.toFixed(2)}
                  </td>
                  <td className={`py-1.5 pr-3 font-mono ${d.pnlPct >= 0 ? "text-accent" : "text-danger"}`}>
                    {d.pnlPct >= 0 ? "+" : ""}
                    {d.pnlPct.toFixed(2)}%
                  </td>
                  <td className="py-1.5 pr-3 text-muted">{d.trades}</td>
                  <td className="py-1.5 pr-3 text-muted">{d.wins}</td>
                  <td className="py-1.5 pr-3 text-muted">{d.losses}</td>
                  <td className="py-1.5 pr-3 text-muted">{d.winRate.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Todas las operaciones" subtitle={`Últimas ${Math.min(40, tradesRaw.length)} — con instantánea completa de reproducibilidad`}>
        <div className="flex flex-col gap-2">
          {[...tradesRaw]
            .reverse()
            .slice(0, 40)
            .map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted">{t.closedAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                  <span className="font-medium">{t.asset.symbol}</span>
                  <Badge tone={t.direction === "LONG" ? "success" : "danger"}>{tDirection(t.direction)}</Badge>
                  <span className="text-muted">{t.strategyVersion?.strategy.name ?? "—"}</span>
                  <Badge tone="muted">{tExitReason(t.exitReason)}</Badge>
                </div>
                <span className={`font-mono ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>
                  {t.netPnl >= 0 ? "+" : ""}€{t.netPnl.toFixed(2)}
                </span>
              </div>
            ))}
        </div>
        <Link href="/paper-trading" className="mt-3 inline-block text-xs text-accent underline">
          Ver posiciones abiertas →
        </Link>
      </Card>

      {overallStats.trades < MIN_TRADES_FOR_STATS && (
        <p className="text-center text-xs text-muted">
          <Badge tone="warn">INSUFFICIENT DATA</Badge> Solo {overallStats.trades} operación(es) registrada(s) — las estadísticas de arriba
          todavía no son estadísticamente significativas.
        </p>
      )}
    </div>
  );
}
