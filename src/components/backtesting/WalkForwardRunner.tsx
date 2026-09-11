"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { STRATEGY_OPTIONS, ASSET_OPTIONS } from "./options";
import { tEvidenceLevel } from "@/lib/i18n";

interface WindowResult {
  windowIndex: number;
  trainRange: [string, string];
  oosRange: [string, string];
  trainMetrics: { totalReturnPct: number; sharpe: number | null };
  oosMetrics: { totalReturnPct: number; sharpe: number | null };
  degraded: boolean;
}

export function WalkForwardRunner() {
  const [strategyDefId, setStrategyDefId] = useState(STRATEGY_OPTIONS[0].id);
  const [symbol, setSymbol] = useState(ASSET_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<null | {
    walkForward: { windows: WindowResult[]; aggregateOosMetrics: { avgReturnPct: number; avgSharpe: number | null; winRateOfWindows: number } };
    overfitting: { risk: string; flags: string[] };
  }>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/walk-forward", { method: "POST", body: JSON.stringify({ strategyDefId, symbol }) });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Ejecutar Prueba Walk-Forward" subtitle="ENTRENAMIENTO → FUERA DE MUESTRA, avanzando a lo largo de toda la serie. La porción OOS de cada ventana nunca fue vista por la porción de entrenamiento de esa ventana.">
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
            {loading ? "Ejecutando…" : "Ejecutar Walk-Forward"}
          </button>
        </div>
      </Card>

      {data && (
        <>
          <Card title="Resultado OOS Agregado">
            <div className="flex flex-wrap gap-4 font-mono text-sm">
              <span>Retorno OOS medio: {data.walkForward.aggregateOosMetrics.avgReturnPct.toFixed(1)}%</span>
              <span>Sharpe OOS medio: {data.walkForward.aggregateOosMetrics.avgSharpe?.toFixed(2) ?? "—"}</span>
              <span>Ventanas rentables: {(data.walkForward.aggregateOosMetrics.winRateOfWindows * 100).toFixed(0)}%</span>
            </div>
            <Badge tone={data.overfitting.risk === "HIGH" ? "danger" : data.overfitting.risk === "MEDIUM" ? "warn" : "success"} className="mt-2">
              RIESGO DE SOBREAJUSTE: {tEvidenceLevel(data.overfitting.risk)}
            </Badge>
          </Card>

          <Card title={`Ventanas (${data.walkForward.windows.length})`}>
            {data.walkForward.windows.length === 0 ? (
              <p className="text-sm text-muted">No hay suficiente histórico para una ventana walk-forward completa.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-3">#</th>
                      <th className="py-1 pr-3">Rango OOS</th>
                      <th className="py-1 pr-3">Retorno Entrenamiento</th>
                      <th className="py-1 pr-3">Retorno OOS</th>
                      <th className="py-1 pr-3">¿Degradada?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.walkForward.windows.map((w) => (
                      <tr key={w.windowIndex} className="border-t border-bg-border">
                        <td className="py-1.5 pr-3">{w.windowIndex}</td>
                        <td className="py-1.5 pr-3 font-mono">{new Date(w.oosRange[0]).toLocaleDateString()} – {new Date(w.oosRange[1]).toLocaleDateString()}</td>
                        <td className="py-1.5 pr-3 font-mono">{w.trainMetrics.totalReturnPct.toFixed(1)}%</td>
                        <td className={`py-1.5 pr-3 font-mono ${w.oosMetrics.totalReturnPct >= 0 ? "text-accent" : "text-danger"}`}>{w.oosMetrics.totalReturnPct.toFixed(1)}%</td>
                        <td className="py-1.5 pr-3">{w.degraded ? <Badge tone="danger">sí</Badge> : <Badge tone="muted">no</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
