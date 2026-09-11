"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Badge } from "@/components/ui/Badge";
import { EquityCurveChart } from "@/components/charts/EquityCurveChart";
import { STRATEGY_OPTIONS, ASSET_OPTIONS } from "./options";

interface BacktestMetrics {
  totalReturnPct: number;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number;
  winRate: number;
  trades: number;
  profitFactor: number | null;
  finalEquity: number;
}

export function BacktestRunner() {
  const [strategyDefId, setStrategyDefId] = useState(STRATEGY_OPTIONS[0].id);
  const [symbol, setSymbol] = useState(ASSET_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<null | {
    result: { metrics: BacktestMetrics; equityCurve: { t: number; equity: number }[] };
    benchmark: { totalReturnPct: number; maxDrawdownPct: number; sharpe: number | null };
    comparison: { summary: string; strategyBeatsReturn: boolean };
    overfitting: { risk: string; flags: string[] };
    isDemo: boolean;
  }>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/backtest", { method: "POST", body: JSON.stringify({ strategyDefId, symbol }) });
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Run a Backtest" subtitle="No look-ahead bias: strategy only ever sees bars up to the current index; signals fill at the next bar's open.">
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
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Total Return" value={`${data.result.metrics.totalReturnPct.toFixed(1)}%`} tone={data.result.metrics.totalReturnPct >= 0 ? "positive" : "negative"} />
            <StatTile label="Sharpe" value={data.result.metrics.sharpe?.toFixed(2) ?? "—"} />
            <StatTile label="Sortino" value={data.result.metrics.sortino?.toFixed(2) ?? "—"} />
            <StatTile label="Max Drawdown" value={`${data.result.metrics.maxDrawdownPct.toFixed(1)}%`} />
            <StatTile label="Win Rate" value={`${(data.result.metrics.winRate * 100).toFixed(0)}%`} />
            <StatTile label="Trades" value={data.result.metrics.trades} />
            <StatTile label="Profit Factor" value={data.result.metrics.profitFactor?.toFixed(2) ?? "—"} />
            <StatTile label="Final Equity" value={`€${data.result.metrics.finalEquity.toFixed(2)}`} />
          </div>

          <Card title="Equity Curve">
            <EquityCurveChart data={data.result.equityCurve} />
          </Card>

          <Card title="Benchmark: Buy & Hold">
            <p className={`text-sm ${data.comparison.strategyBeatsReturn ? "text-accent" : "text-danger"}`}>{data.comparison.summary}</p>
            <div className="mt-2 flex gap-4 font-mono text-xs text-muted">
              <span>B&H Return: {data.benchmark.totalReturnPct.toFixed(1)}%</span>
              <span>B&H Max DD: {data.benchmark.maxDrawdownPct.toFixed(1)}%</span>
              <span>B&H Sharpe: {data.benchmark.sharpe?.toFixed(2) ?? "—"}</span>
            </div>
          </Card>

          <Card title="Overfitting Detector">
            <Badge tone={data.overfitting.risk === "HIGH" ? "danger" : data.overfitting.risk === "MEDIUM" ? "warn" : "success"}>
              OVERFITTING RISK: {data.overfitting.risk}
            </Badge>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
              {data.overfitting.flags.length === 0 ? <li>No red flags detected.</li> : data.overfitting.flags.map((f, i) => <li key={i}>• {f}</li>)}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
