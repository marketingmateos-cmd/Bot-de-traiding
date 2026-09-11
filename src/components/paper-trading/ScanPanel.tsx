"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { GateStepList } from "@/components/GateStepList";
import { Badge } from "@/components/ui/Badge";

interface ScanCandidate {
  symbol: string;
  strategyName: string;
  strategyVersionId: string;
  signal: { direction: "LONG" | "SHORT"; strength: number; reason: string } | null;
  verdict: "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED" | "NO_SIGNAL";
  blockedBy: string | null;
  steps: { name: string; passed: boolean; downgrade: boolean; detail: string }[] | null;
}

export function ScanPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScanCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runScan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/paper-trading/scan", { method: "POST", body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setResults(data.results);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  async function runTick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/paper-trading/tick", { method: "POST", body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tick failed");
    } finally {
      setLoading(false);
    }
  }

  const withSignal = results?.filter((r) => r.signal !== null) ?? [];
  const noSignalCount = (results?.length ?? 0) - withSignal.length;

  return (
    <Card
      title="Scan for signals"
      subtitle="Runs every active strategy × asset through the full Trade Gate (11 checks). Only APPROVED verdicts open a simulated position."
      actions={
        <div className="flex gap-2">
          <button onClick={runTick} disabled={loading} className="rounded border border-bg-border px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50">
            Check stops/targets
          </button>
          <button onClick={runScan} disabled={loading} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-black hover:bg-accent-dim disabled:opacity-50">
            {loading ? "Scanning…" : "Run Scan"}
          </button>
        </div>
      }
    >
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {!results && <p className="text-sm text-muted">No scan run yet this session.</p>}
      {results && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            {withSignal.length} signal(s) generated, {noSignalCount} asset/strategy pair(s) had no signal.
          </p>
          {withSignal.map((r, i) => (
            <div key={i} className="rounded border border-bg-border bg-black/20 p-3">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-100">
                  {r.symbol} · {r.strategyName} · <Badge tone={r.signal!.direction === "LONG" ? "success" : "danger"}>{r.signal!.direction}</Badge>
                </div>
              </div>
              <p className="mb-2 text-xs text-muted">{r.signal!.reason}</p>
              {r.steps && <GateStepList steps={r.steps} verdict={r.verdict} blockedBy={r.blockedBy} />}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
