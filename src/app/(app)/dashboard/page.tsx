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
          <h1 className="text-lg font-semibold text-slate-100">Dashboard</h1>
          <Badge tone="muted">DEMO MODE</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">What&apos;s happening right now across the lab — paper trading only, nothing here touches real money.</p>
      </div>

      {breakers.length > 0 && (
        <Card className="border-danger/40 bg-danger/5">
          <div className="flex items-center gap-2 text-sm font-semibold text-danger">Circuit breaker(s) tripped — new paper trades are blocked</div>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-300">
            {breakers.map((b) => (
              <li key={b.id}>
                <span className="font-mono">{b.name}</span>: {b.trippedReason}
              </li>
            ))}
          </ul>
          <Link href="/risk" className="mt-2 inline-block text-xs text-accent underline">
            Go to Risk Center to resolve →
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Portfolio Equity" value={`€${equity.toFixed(2)}`} sublabel={`Start: €${(account?.startingBalance ?? 100).toFixed(2)}`} />
        <StatTile label="Total P&L" value={`${totalPnl >= 0 ? "+" : ""}€${totalPnl.toFixed(2)}`} tone={totalPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="Daily P&L" value={`${dailyPnl >= 0 ? "+" : ""}€${dailyPnl.toFixed(2)}`} tone={dailyPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="Drawdown" value={`${drawdown.current.toFixed(1)}%`} sublabel={`Max: ${drawdown.max.toFixed(1)}%`} tone={drawdown.current > 10 ? "negative" : "neutral"} />
        <StatTile label="Win Rate" value={`${winRate.toFixed(0)}%`} sublabel={`${allTrades.length} closed trades`} />
        <StatTile label="Open Positions" value={openPositions.length} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Market Intelligence — BTC" subtitle={`Regime: ${headline.regime.regime}`} className="lg:col-span-1">
          {headline.marketIntelligence ? (
            <>
              <div className="mb-3 font-mono text-3xl font-bold text-accent">{headline.marketIntelligence.score}<span className="text-sm text-muted">/100</span></div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={regimeTone(headline.regime.regime)}>{headline.regime.regime}</Badge>
                <Badge tone="muted">Data Confidence {headline.marketIntelligence.dataConfidence}%</Badge>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Insufficient bars to compute yet.</p>
          )}
          <Link href="/intelligence" className="mt-3 inline-block text-xs text-accent underline">
            Full breakdown →
          </Link>
        </Card>

        <Card title="What is the system learning?" className="lg:col-span-1">
          <ul className="flex flex-col gap-2 text-xs text-slate-300">
            <li>
              <span className="font-semibold text-slate-100">{leagueEntries.length}</span> active strategy version(s) tracked.
            </li>
            <li>
              <span className="font-semibold text-warn">{insufficientEvidenceCount}</span> strategy version(s) still have INSUFFICIENT EVIDENCE — see{" "}
              <Link href="/luck-vs-edge" className="text-accent underline">Luck vs Edge</Link>.
            </li>
            <li>
              <span className="font-semibold text-danger">{failingStrategies.length}</span> strategy version(s) currently net-negative in paper trading.
            </li>
            <li>
              Data quality across sampled assets: <span className="font-semibold text-slate-100">{avgDataQuality}/100</span>.
            </li>
          </ul>
          <Link href="/league" className="mt-3 inline-block text-xs text-accent underline">
            Strategy League →
          </Link>
        </Card>

        <Card title="AI Usage Today" className="lg:col-span-1">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Calls Today" value={`${budget.callsToday}/${budget.dailyBudget}`} />
            <StatTile label="Budget Left" value={`${budget.budgetRemainingPct.toFixed(0)}%`} />
            <StatTile label="Est. Cost (mo)" value={`$${budget.monthlyCostUsd.toFixed(2)}`} />
            <StatTile label="Cache Hit Rate" value={`${(budget.cacheHitRate * 100).toFixed(0)}%`} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Open Paper Positions" subtitle={`${openPositions.length} open`}>
          {openPositions.length === 0 ? (
            <p className="text-sm text-muted">No open positions.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {openPositions.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-sm">
                  <div>
                    <span className="font-semibold">{p.asset.symbol}</span>{" "}
                    <Badge tone={p.direction === "LONG" ? "success" : "danger"}>{p.direction}</Badge>
                  </div>
                  <div className="font-mono text-xs text-muted">entry {p.entryPrice.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
          <Link href="/paper-trading" className="mt-3 inline-block text-xs text-accent underline">
            Go to Paper Trading →
          </Link>
        </Card>

        <Card title="Recent Alerts">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">No alerts yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-xs">
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
      </div>

      <Card title="Recent Trades">
        {recentTrades.length === 0 ? (
          <p className="text-sm text-muted">No closed trades yet. Run a Paper Trading scan to generate activity.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Asset</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entry</th>
                  <th className="py-1 pr-3">Exit</th>
                  <th className="py-1 pr-3">Net P&L</th>
                  <th className="py-1 pr-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t) => (
                  <tr key={t.id} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{t.asset.symbol}</td>
                    <td className="py-1.5 pr-3">{t.direction}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.entryPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.exitPrice.toFixed(2)}</td>
                    <td className={`py-1.5 pr-3 font-mono ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>{t.netPnl.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-muted">{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Link href="/journal" className="mt-3 inline-block text-xs text-accent underline">
          Full Trade Journal →
        </Link>
      </Card>
    </div>
  );
}
