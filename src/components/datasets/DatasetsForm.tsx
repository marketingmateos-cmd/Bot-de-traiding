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
  minPrice: number | null;
  maxPrice: number | null;
  minVolume: number | null;
  maxVolume: number | null;
}

interface ProvenanceEntry {
  importLogId: string;
  source: string;
  rangeStart: string;
  rangeEnd: string;
  rowsInserted: number;
  rowsUpdated: number;
  status: string;
  importedAt: string;
}

const TIMEFRAMES: TimeframeCode[] = ["M15", "H1", "H4", "D1"];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function fmtNum(n: number | null): string {
  return n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Fase 16 — Quality Report (spec section 10) + manifest + provenance (section 11), fetched together from GET /api/datasets/[id]. Descriptive only — never used to select a dataset or strategy. */
function DatasetDetailView({ dataset, onClose }: { dataset: DatasetView; onClose: () => void }) {
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceEntry[] | null>(null);
  useEffect(() => {
    fetch(`/api/datasets/${dataset.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        setManifest(json.manifest);
        setProvenance(json.provenance);
      });
  }, [dataset.id]);

  return (
    <Card title={`Quality Report — ${dataset.symbol} ${dataset.timeframe}`} actions={<button onClick={onClose} className="text-xs text-muted hover:text-slate-200">cerrar</button>}>
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <div className="text-muted">Expected interval</div>
          <div className="mt-1 font-mono">{dataset.timeframe}</div>
        </div>
        <div>
          <div className="text-muted">Rows</div>
          <div className="mt-1 font-mono">{dataset.rowCount}</div>
        </div>
        <div>
          <div className="text-muted">Coverage</div>
          <div className="mt-1 font-mono">{dataset.coveragePct.toFixed(2)}%</div>
        </div>
        <div>
          <div className="text-muted">Quality</div>
          <div className="mt-1 font-mono">{dataset.quality}</div>
        </div>
        <div>
          <div className="text-muted">Gaps</div>
          <div className="mt-1 font-mono">{dataset.gapCount}</div>
        </div>
        <div>
          <div className="text-muted">Duplicates</div>
          <div className="mt-1 font-mono">{dataset.duplicateCount}</div>
        </div>
        <div>
          <div className="text-muted">isDemo</div>
          <div className="mt-1 font-mono">{String(dataset.isDemo)}</div>
        </div>
        <div>
          <div className="text-muted">Source</div>
          <div className="mt-1 font-mono">{dataset.source}</div>
        </div>
        <div>
          <div className="text-muted">Min / Max price</div>
          <div className="mt-1 font-mono">
            {fmtNum(dataset.minPrice)} / {fmtNum(dataset.maxPrice)}
          </div>
        </div>
        <div>
          <div className="text-muted">Min / Max volume</div>
          <div className="mt-1 font-mono">
            {fmtNum(dataset.minVolume)} / {fmtNum(dataset.maxVolume)}
          </div>
        </div>
        <div>
          <div className="text-muted">First timestamp</div>
          <div className="mt-1 font-mono text-[11px]">{fmtDate(dataset.startDate)}</div>
        </div>
        <div>
          <div className="text-muted">Last timestamp</div>
          <div className="mt-1 font-mono text-[11px]">{fmtDate(dataset.endDate)}</div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted">
        min/max price/volume descriptivos únicamente — nunca usados para seleccionar un dataset o una estrategia. minPrice/maxPrice/minVolume/maxVolume
        aparecen como &quot;—&quot; para datasets registrados antes de Fase 16 (nunca backfilled retroactivamente).
      </p>

      {provenance && provenance.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-slate-200">Provenance — import log(s) que construyeron este rango</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Import log</th>
                  <th className="py-1 pr-3">Range</th>
                  <th className="py-1 pr-3">Inserted</th>
                  <th className="py-1 pr-3">Updated</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Imported at</th>
                </tr>
              </thead>
              <tbody>
                {provenance.map((p) => (
                  <tr key={p.importLogId} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-mono text-[10px] text-muted">{p.importLogId}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">
                      {fmtDate(p.rangeStart)} → {fmtDate(p.rangeEnd)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{p.rowsInserted}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.rowsUpdated}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={p.status === "DONE" ? "success" : "danger"}>{p.status}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{fmtDate(p.importedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-slate-200">Manifest (JSON)</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-3 text-[11px] text-slate-200">{manifest ? JSON.stringify(manifest, null, 2) : "Cargando…"}</pre>
      </details>
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
  const [detailFor, setDetailFor] = useState<DatasetView | null>(null);

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
                      <button onClick={() => setDetailFor(d)} className="text-accent hover:underline">
                        quality report
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detailFor && <DatasetDetailView dataset={detailFor} onClose={() => setDetailFor(null)} />}
    </div>
  );
}
