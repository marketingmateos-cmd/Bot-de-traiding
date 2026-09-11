import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { HypothesisForm } from "@/components/research/HypothesisForm";
import { env } from "@/lib/env";
import { tEvidenceLevel, tVerdict } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const analyses = await prisma.aIAnalysis.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const hypotheses = await prisma.hypothesis.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { strategyVersion: { include: { strategy: true } } } });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Laboratorio de IA</h1>
        <p className="mt-1 text-sm text-muted">
          Investigación multi-agente: un Analista produce una hipótesis estructurada, una Crítica intenta refutarla.{" "}
          {!env.hasAnthropicKey && <Badge tone="muted">Ejecutando IA DEMO basada en reglas (no hay ANTHROPIC_API_KEY configurada)</Badge>}
        </p>
      </div>

      <HypothesisForm />

      <Card title="Hipótesis Recientes">
        {hypotheses.length === 0 ? (
          <p className="text-sm text-muted">Aún no se ha probado ninguna hipótesis.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {hypotheses.map((h) => (
              <div key={h.id} className="rounded border border-bg-border bg-black/20 p-3 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={h.status === "ACCEPTED" ? "success" : h.status === "REJECTED" ? "danger" : "warn"}>{tVerdict(h.status)}</Badge>
                  <Badge tone="muted">{h.evidenceLevel ? tEvidenceLevel(h.evidenceLevel) : "—"}</Badge>
                </div>
                <p className="text-slate-200">{h.statement}</p>
                <p className="mt-1 text-muted">{h.rationale}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Llamadas Recientes a IA Analista / Crítica">
        {analyses.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay análisis de IA — ejecuta un escaneo en Paper Trading para generar algunos.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {analyses.map((a) => (
              <details key={a.id} className="rounded border border-bg-border bg-black/20 p-3 text-xs">
                <summary className="cursor-pointer text-slate-200">
                  <Badge tone={a.kind === "ANALYST" ? "info" : "warn"}>{a.kind === "ANALYST" ? "ANALISTA" : "CRÍTICA"}</Badge> · {a.model} · {a.createdAt.toLocaleString()}
                  {a.cached && <Badge tone="muted" className="ml-1">caché</Badge>}
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-slate-300">
                  {JSON.stringify(a.output, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
