"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { TimeframeCode } from "@/lib/providers/types";

interface DatasetView {
  id: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  source: string;
  isDemo: boolean;
  coveragePct: number;
  gapCount: number;
  duplicateCount: number;
  quality: number;
  datasetHash: string;
  createdAt: string;
}

const TIMEFRAMES: TimeframeCode[] = ["M15", "H1", "H4", "D1"];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function ManifestView({ dataset, onClose }: { dataset: DatasetView; onClose: () => void }) {
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch(`/api/datasets/${dataset.id}`)
      .then((r) => r.json())
      .then((json) => json.ok && setManifest(json.manifest));
  }, [dataset.id]);

  return (
    <Card title={`Manifest — ${dataset.symbol} ${dataset.timeframe}`} actions={<button onClick={onClose} className="text-xs text-muted hover:text-slate-200">cerrar</button>}>
      <pre className="overflow-x-auto rounded bg-black/30 p-3 text-[11px] text-slate-200">{manifest ? JSON.stringify(manifest, null, 2) : "Cargando…"}</pre>
    </Card>
  );
}

export function DatasetsForm({ assetSymbols }: { assetSymbols: string[] }) {
  const [symbol, setSymbol] = useState(assetSymbols.includes("BTC") ? "BTC" : assetSymbols[0] ?? "BTC");
  const [timeframe, setTimeframe] = useState<TimeframeCode>("H1");
  const [startDate, setStartDate] = useState("2026-03-01");
  const [endDate, setEndDate] = useState("2026-08-31");
  const [source, setSource] = useState("binance_csv");

  const [datasets, setDatasets] = useState<DatasetView[]>([]);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifestFor, setManifestFor] = useState<DatasetView | null>(null);

  async function refresh() {
    const res = await fetch("/api/datasets");
    const json = await res.json();
    if (json.ok) setDatasets(json.datasets);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function register() {
    setRegistering(true);
    setError(null);
    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        body: JSON.stringify({ symbol, timeframe, startDate: new Date(startDate).toISOString(), endDate: new Date(endDate + "T23:00:00.000Z").toISOString(), source }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "No se pudo registrar el dataset.");
        return;
      }
      await refresh();
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card title="Registrar dataset">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          <div>
            <div className="text-xs text-slate-300">Symbol</div>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100">
              {assetSymbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-300">Timeframe</div>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as TimeframeCode)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100">
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-300">Fecha inicio</div>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100" />
          </div>
          <div>
            <div className="text-xs text-slate-300">Fecha fin</div>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100" />
          </div>
          <div>
            <div className="text-xs text-slate-300">Source (MarketData.source real)</div>
            <input value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm font-mono text-slate-100" placeholder="binance_csv" />
          </div>
        </div>
        <button onClick={register} disabled={registering} className="mt-4 rounded border border-accent bg-accent/10 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
          {registering ? "Registrando…" : "Register Dataset"}
        </button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <p className="mt-2 text-[11px] text-muted">
          Registrar solo valida y calcula el hash de velas YA existentes en MarketData para ese rango/source — nunca descarga, genera ni rellena nada.
          Registrar el mismo rango dos veces es idempotente (devuelve el dataset existente).
        </p>
      </Card>

      <Card title="Datasets registrados" subtitle={`${datasets.length} dataset(s)`}>
        {datasets.length === 0 ? (
          <p className="text-xs text-muted">Ninguno todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Symbol</th>
                  <th className="py-1 pr-3">TF</th>
                  <th className="py-1 pr-3">Start</th>
                  <th className="py-1 pr-3">End</th>
                  <th className="py-1 pr-3">Rows</th>
                  <th className="py-1 pr-3">Source</th>
                  <th className="py-1 pr-3">isDemo</th>
                  <th className="py-1 pr-3">Coverage</th>
                  <th className="py-1 pr-3">Gaps</th>
                  <th className="py-1 pr-3">Dup</th>
                  <th className="py-1 pr-3">Quality</th>
                  <th className="py-1 pr-3">Hash</th>
                  <th className="py-1 pr-3">Creado</th>
                  <th className="py-1 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{d.symbol}</td>
                    <td className="py-1.5 pr-3">{d.timeframe}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{fmtDate(d.startDate)}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{fmtDate(d.endDate)}</td>
                    <td className="py-1.5 pr-3 font-mono">{d.rowCount}</td>
                    <td className="py-1.5 pr-3 font-mono">{d.source}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={d.isDemo ? "warn" : "success"}>{d.isDemo ? "DEMO" : "REAL"}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{d.coveragePct.toFixed(1)}%</td>
                    <td className="py-1.5 pr-3 font-mono">{d.gapCount}</td>
                    <td className="py-1.5 pr-3 font-mono">{d.duplicateCount}</td>
                    <td className="py-1.5 pr-3 font-mono">{d.quality}</td>
                    <td className="py-1.5 pr-3 font-mono text-[10px] text-muted" title={d.datasetHash}>
                      {d.datasetHash.slice(0, 10)}…
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{fmtDate(d.createdAt)}</td>
                    <td className="py-1.5 pr-3">
                      <button onClick={() => setManifestFor(d)} className="text-accent hover:underline">
                        manifest
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {manifestFor && <ManifestView dataset={manifestFor} onClose={() => setManifestFor(null)} />}
    </div>
  );
}
