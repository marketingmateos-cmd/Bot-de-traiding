import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { tVerdict } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const experiments = await prisma.experiment.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { hypothesis: true } });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Experimentos</h1>
        <p className="mt-1 text-sm text-muted">
          Los experimentos de largo plazo (ventanas de 7/30/90/180/365 días) se crean automáticamente cada vez que se prueba una hipótesis desde el Laboratorio de IA.
        </p>
      </div>

      {experiments.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Aún no hay experimentos — prueba una hipótesis en el Laboratorio de IA para crear uno.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {experiments.map((e) => {
            const result = e.result as { status?: string; metrics?: { totalReturnPct?: number; sharpe?: number | null } } | null;
            return (
              <Card key={e.id} title={e.name} subtitle={`ventana de ${e.durationDays} días`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={e.status === "COMPLETED" ? "success" : "muted"}>{e.status === "COMPLETED" ? "COMPLETADO" : e.status}</Badge>
                  {result?.status && <Badge tone="info">{tVerdict(result.status)}</Badge>}
                </div>
                {result?.metrics && (
                  <div className="mt-2 flex gap-4 font-mono text-xs">
                    <span>Retorno: {result.metrics.totalReturnPct?.toFixed(1)}%</span>
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
