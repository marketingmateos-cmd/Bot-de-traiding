import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { HypothesisForm } from "@/components/research/HypothesisForm";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const analyses = await prisma.aIAnalysis.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const hypotheses = await prisma.hypothesis.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { strategyVersion: { include: { strategy: true } } } });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">AI Research Lab</h1>
        <p className="mt-1 text-sm text-muted">
          Multi-agent research: an Analyst produces a structured hypothesis, a Critic tries to falsify it.{" "}
          {!env.hasAnthropicKey && <Badge tone="muted">Running rule-based DEMO AI (no ANTHROPIC_API_KEY set)</Badge>}
        </p>
      </div>

      <HypothesisForm />

      <Card title="Recent Hypotheses">
        {hypotheses.length === 0 ? (
          <p className="text-sm text-muted">No hypotheses tested yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {hypotheses.map((h) => (
              <div key={h.id} className="rounded border border-bg-border bg-black/20 p-3 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={h.status === "ACCEPTED" ? "success" : h.status === "REJECTED" ? "danger" : "warn"}>{h.status}</Badge>
                  <Badge tone="muted">{h.evidenceLevel}</Badge>
                </div>
                <p className="text-slate-200">{h.statement}</p>
                <p className="mt-1 text-muted">{h.rationale}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent AI Analyst / Critic Calls">
        {analyses.length === 0 ? (
          <p className="text-sm text-muted">No AI analyses yet — run a Paper Trading scan to generate some.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {analyses.map((a) => (
              <details key={a.id} className="rounded border border-bg-border bg-black/20 p-3 text-xs">
                <summary className="cursor-pointer text-slate-200">
                  <Badge tone={a.kind === "ANALYST" ? "info" : "warn"}>{a.kind}</Badge> · {a.model} · {a.createdAt.toLocaleString()}
                  {a.cached && <Badge tone="muted" className="ml-1">cached</Badge>}
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
