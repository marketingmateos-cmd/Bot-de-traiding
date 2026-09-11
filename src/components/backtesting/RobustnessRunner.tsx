"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { STRATEGY_OPTIONS, ASSET_OPTIONS } from "./options";
import { tEvidenceLevel } from "@/lib/i18n";

export function RobustnessRunner() {
  const [strategyDefId, setStrategyDefId] = useState(STRATEGY_OPTIONS[0].id);
  const [symbol, setSymbol] = useState(ASSET_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<null | {
    robustness: { score: number; factors: { name: string; score: number; detail: string }[] };
    overfitting: { risk: string; flags: string[] };
    parameterPerturbationReturns: number[];
    crossAssetReturns: number[];
    costSensitivityReturns: number[];
  }>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/robustness", { method: "POST", body: JSON.stringify({ strategyDefId, symbol }) });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Ejecutar Suite de Robustez" subtitle="Combina walk-forward, perturbación de parámetros, generalización entre activos y sensibilidad a costes en una sola puntuación. Tarda un rato — ejecuta varios backtests.">
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
            {loading ? "Ejecutando suite completa…" : "Ejecutar Suite de Robustez"}
          </button>
        </div>
      </Card>

      {data && (
        <>
          <Card title="Puntuación de Robustez">
            <div className="mb-3 font-mono text-4xl font-bold text-accent">
              {data.robustness.score}
              <span className="text-base text-muted">/100</span>
            </div>
            <div className="flex flex-col gap-2">
              {data.robustness.factors.map((f) => (
                <div key={f.name} className="text-xs">
                  <div className="mb-0.5 flex justify-between text-muted">
                    <span>{f.name}</span>
                    <span className="font-mono">{Math.round(f.score)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${f.score}%` }} />
                  </div>
                  <div className="mt-0.5 text-muted">{f.detail}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Detector de Sobreajuste">
            <Badge tone={data.overfitting.risk === "HIGH" ? "danger" : data.overfitting.risk === "MEDIUM" ? "warn" : "success"}>
              RIESGO DE SOBREAJUSTE: {tEvidenceLevel(data.overfitting.risk)}
            </Badge>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
              {data.overfitting.flags.map((f, i) => (
                <li key={i}>• {f}</li>
              ))}
            </ul>
          </Card>

          <Card title="Retornos entre Activos">
            <div className="flex flex-wrap gap-3 font-mono text-xs">
              {data.crossAssetReturns.map((r, i) => (
                <span key={i} className={r >= 0 ? "text-accent" : "text-danger"}>
                  {r.toFixed(1)}%
                </span>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
