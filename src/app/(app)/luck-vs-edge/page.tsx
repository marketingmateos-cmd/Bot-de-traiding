import { prisma } from "@/lib/db";
import { getStrategyPerformanceStats } from "@/lib/engines/strategyStats";
import { assessEvidence } from "@/lib/engines/luckVsEdge";
import { Card } from "@/components/ui/Card";
import { Badge, verdictTone } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function LuckVsEdgePage() {
  const versions = await prisma.strategyVersion.findMany({ include: { strategy: true } });

  const assessments = await Promise.all(
    versions.map(async (v) => {
      const stats = await getStrategyPerformanceStats(v.id);
      const latestRobustness = await prisma.backtest.findFirst({ where: { strategyVersionId: v.id, kind: "ROBUSTNESS" }, orderBy: { createdAt: "desc" } });
      const summary = latestRobustness?.summary as { robustness?: { score: number } } | null;
      const evidence = assessEvidence(stats, { robustnessScore: summary?.robustness?.score ?? null });
      return { name: `${v.strategy.name} v${v.version}`, stats, evidence };
    })
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Luck vs Edge — Prove It Mode</h1>
        <p className="mt-1 text-sm text-muted">
          A winning streak is never, by itself, proof of an edge. Every verdict here can only be downgraded by more evidence, never upgraded by a good week.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {assessments.map((a) => (
          <Card key={a.name} title={a.name}>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={verdictTone(a.evidence.verdict)}>{a.evidence.verdict.replace(/_/g, " ")}</Badge>
              <Badge tone={verdictTone(a.evidence.evidenceLevel)}>{a.evidence.evidenceLevel} EVIDENCE</Badge>
            </div>
            <div className="mb-2 flex flex-wrap gap-3 font-mono text-xs text-muted">
              <span>{a.stats.trades} trades</span>
              <span>win rate {(a.stats.winRate * 100).toFixed(0)}%</span>
              <span>Sharpe {a.stats.sharpe?.toFixed(2) ?? "—"}</span>
              <span>max DD {a.stats.maxDrawdownPct.toFixed(1)}%</span>
            </div>
            {a.evidence.warnings.length === 0 ? (
              <p className="text-xs text-accent">No red flags at this sample size.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-xs text-warn">
                {a.evidence.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
