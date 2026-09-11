"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge, verdictTone } from "@/components/ui/Badge";
import { STRATEGY_OPTIONS, ASSET_OPTIONS } from "@/components/backtesting/options";

export function HypothesisForm() {
  const router = useRouter();
  const [statement, setStatement] = useState("Momentum works better when volume is above its recent average.");
  const [strategyDefId, setStrategyDefId] = useState(STRATEGY_OPTIONS[1].id);
  const [symbol, setSymbol] = useState(ASSET_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | { hypothesis: { status: string; evidenceLevel: string; rationale: string } }>(null);

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch("/api/hypotheses", {
        method: "POST",
        body: JSON.stringify({ statement, strategyDefId, symbol }),
      });
      const data = await res.json();
      setResult(data);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Test a Hypothesis" subtitle="Hypothesis → Backtest → Walk-Forward → Robustness → Accept/Reject, run as one pipeline.">
      <div className="flex flex-col gap-3">
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          className="w-full rounded border border-bg-border bg-black/20 px-3 py-2 text-sm text-slate-200"
          rows={2}
        />
        <div className="flex flex-wrap gap-2">
          <select value={strategyDefId} onChange={(e) => setStrategyDefId(e.target.value)} className="rounded border border-bg-border bg-black/20 px-2 py-1.5 text-xs text-slate-200">
            {STRATEGY_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded border border-bg-border bg-black/20 px-2 py-1.5 text-xs text-slate-200">
            {ASSET_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={submit} disabled={loading} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50">
            {loading ? "Testing…" : "Test Hypothesis"}
          </button>
        </div>
        {result?.hypothesis && (
          <div className="rounded border border-bg-border bg-black/20 p-3 text-xs">
            <Badge tone={verdictTone(result.hypothesis.status)}>{result.hypothesis.status}</Badge>{" "}
            <Badge tone="muted">{result.hypothesis.evidenceLevel} evidence</Badge>
            <p className="mt-2 text-muted">{result.hypothesis.rationale}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
