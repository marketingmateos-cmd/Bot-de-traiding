"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Badge } from "@/components/ui/Badge";
import { STRATEGY_OPTIONS, ASSET_OPTIONS } from "./options";

export function MonteCarloRunner() {
  const [strategyDefId, setStrategyDefId] = useState(STRATEGY_OPTIONS[0].id);
  const [symbol, setSymbol] = useState(ASSET_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<null | {
    tradeCount: number;
    monteCarlo: {
      iterations: number;
      finalReturnPct: { p5: number; p25: number; median: number; p75: number; p95: number };
      maxDrawdownPct: { p5: number; p50: number; p95: number };
      probabilityOfRuin: number;
      probabilityOfLoss: number;
      ruinThresholdPct: number;
    };
  }>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/monte-carlo", { method: "POST", body: JSON.stringify({ strategyDefId, symbol }) });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Run Monte Carlo Simulation"
        subtitle="Resamples the strategy's OWN historical trades in random order (bootstrap) — characterizes risk of ruin, never used to project guaranteed future profit."
      >
        <div className="flex flex-wrap items-center gap-2">
          <select value={strategyDefId} onChange={(e) => setStrategyDefId(e.target.value)} className="rounded border border-bg-border bg-black/20 px-2 py-1.5 text-xs">
            {STRATEGY_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded border border-bg-border bg-black/20 px-2 py-1.5 text-xs">
            {ASSET_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={run} disabled={loading} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50">
            {loading ? "Simulating…" : "Run Monte Carlo"}
          </button>
        </div>
      </Card>

      {data && (
        <>
          {data.tradeCount < 20 && (
            <div className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
              Only {data.tradeCount} historical trade(s) available — the resulting distribution is itself low-confidence.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatTile label="Iterations" value={data.monteCarlo.iterations} />
            <StatTile label="Median Return" value={`${data.monteCarlo.finalReturnPct.median.toFixed(1)}%`} />
            <StatTile label="5th–95th pct Return" value={`${data.monteCarlo.finalReturnPct.p5.toFixed(0)}% / ${data.monteCarlo.finalReturnPct.p95.toFixed(0)}%`} />
            <StatTile label="Median Max Drawdown" value={`${data.monteCarlo.maxDrawdownPct.p50.toFixed(1)}%`} />
            <StatTile
              label={`Probability of Ruin (>${data.monteCarlo.ruinThresholdPct}% loss)`}
              value={`${(data.monteCarlo.probabilityOfRuin * 100).toFixed(1)}%`}
              tone={data.monteCarlo.probabilityOfRuin > 0.1 ? "negative" : "neutral"}
            />
            <StatTile label="Probability of Loss" value={`${(data.monteCarlo.probabilityOfLoss * 100).toFixed(1)}%`} tone={data.monteCarlo.probabilityOfLoss > 0.4 ? "negative" : "neutral"} />
          </div>
          {data.monteCarlo.probabilityOfRuin > 0.15 && <Badge tone="danger">High risk of ruin under resampled trade sequencing</Badge>}
        </>
      )}
    </div>
  );
}
