import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const experiments = await prisma.experiment.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { hypothesis: true } });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Experiments</h1>
        <p className="mt-1 text-sm text-muted">
          Long-term experiments (7/30/90/180/365-day windows) are created automatically whenever a hypothesis is tested from the AI Research Lab.
        </p>
      </div>

      {experiments.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No experiments yet — test a hypothesis in the AI Research Lab to create one.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {experiments.map((e) => {
            const result = e.result as { status?: string; metrics?: { totalReturnPct?: number; sharpe?: number | null } } | null;
            return (
              <Card key={e.id} title={e.name} subtitle={`${e.durationDays} day window`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={e.status === "COMPLETED" ? "success" : "muted"}>{e.status}</Badge>
                  {result?.status && <Badge tone="info">{result.status}</Badge>}
                </div>
                {result?.metrics && (
                  <div className="mt-2 flex gap-4 font-mono text-xs">
                    <span>Return: {result.metrics.totalReturnPct?.toFixed(1)}%</span>
                    <span>Sharpe: {result.metrics.sharpe?.toFixed(2) ?? "—"}</span>
                  </div>
                )}
                {e.hypothesis && <p className="mt-2 text-xs text-muted">{e.hypothesis.statement}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
