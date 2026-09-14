"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge, regimeTone, type BadgeTone } from "@/components/ui/Badge";
import type { BucketStats } from "@/lib/research/regimeAnalysis";
import type { ComparisonDirection, HypothesisStatus, SegmentLabel } from "@/lib/research/hypothesisValidation";

interface GroupComparisonView {
  inGroup: BucketStats;
  outGroup: BucketStats;
  directionSupported: boolean | null;
}

interface HypothesisSegmentView {
  segment: SegmentLabel;
  range: { start: string; end: string };
  candles: number;
  comparison: GroupComparisonView;
}

interface HypothesisResultView {
  id: string;
  description: string;
  strategyId: string;
  strategyName: string;
  direction: ComparisonDirection;
  segments: HypothesisSegmentView[];
  evaluableSegments: number;
  supportingSegments: number;
  stabilityScore: number | null;
  status: HypothesisStatus;
}

interface MarketEventTradeView {
  strategyId: string;
  strategyName: string;
  entryTime: string;
  exitTime: string;
  netPnl: number;
  rMultiple: number | null;
  regime: string | null;
  volatilityBucket: string;
  exitReason: string;
  notionalExposure: number;
}

interface MarketEventStrategySummaryView {
  strategyId: string;
  strategyName: string;
  tradesOverlapping: number;
  totalPnl: number;
  losses: number;
  avgRMultiple: number | null;
  regimesSeen: string[];
  volatilityBucketsSeen: string[];
}

interface MarketEventView {
  eventStart: string;
  eventEnd: string;
  trades: MarketEventTradeView[];
  byStrategy: MarketEventStrategySummaryView[];
  strategiesAffected: number;
  totalStrategies: number;
  allAffectedNegative: boolean;
  classification: "COMMON_MARKET_EVENT" | "STRATEGY_SPECIFIC" | "MIXED" | "NO_OVERLAP";
  status: HypothesisStatus;
}

interface HypothesisValidationResponse {
  ok: boolean;
  error?: string;
  benchmarkRunId: string;
  segmentRanges: { is: { start: string; end: string }; validation: { start: string; end: string }; oos: { start: string; end: string } };
  hypotheses: HypothesisResultView[];
  marketEvent: MarketEventView;
  stabilityScoreFormula: string;
}

interface WalkForwardWindowView {
  windowIndex: number;
  trainRange: [string, string];
  oosRange: [string, string];
  trainMetrics: { trades: number; totalReturnPct: number; profitFactor: number | null };
  oosMetrics: { trades: number; totalReturnPct: number; profitFactor: number | null };
  degraded: boolean;
}

interface WalkForwardStrategyView {
  strategyId: string;
  strategyName: string;
  error?: string;
  windows?: WalkForwardWindowView[];
  aggregateOosMetrics?: { avgReturnPct: number; avgSharpe: number | null; winRateOfWindows: number };
}

interface WalkForwardResponse {
  ok: boolean;
  error?: string;
  options: { windowSizeDays: number; trainFraction: number; stepDays: number };
  note: string;
  strategies: WalkForwardStrategyView[];
}

const STATUS_TONE: Record<HypothesisStatus, BadgeTone> = { SUPPORTED: "success", WEAK: "warn", REJECTED: "danger", INCONCLUSIVE: "muted" };

// Deliberately OOS-first everywhere in this UI (spec section 10).
const DISPLAY_ORDER: SegmentLabel[] = ["OOS", "VALIDATION", "IS"];

function fmtPf(pf: number | null): string {
  return pf === null ? "—" : pf.toFixed(2);
}

function SegmentCell({ seg }: { seg: HypothesisSegmentView | undefined }) {
  if (!seg) return <td className="py-1.5 pr-3 text-muted">—</td>;
  const c = seg.comparison;
  const insufficient = c.inGroup.insufficientSample;
  return (
    <td className={`py-1.5 pr-3 font-mono ${insufficient ? "opacity-50" : ""}`}>
      n={c.inGroup.trades} exp={c.inGroup.expectancy.toFixed(2)}
      {insufficient && <div className="text-[9px] font-sans text-muted">INSUFFICIENT SAMPLE</div>}
    </td>
  );
}

function HypothesisDetail({ h }: { h: HypothesisResultView }) {
  return (
    <Card
      title={h.description}
      subtitle={`${h.strategyName} — dirección esperada: subgrupo ${h.direction === "LOWER" ? "peor" : "mejor"} que el resto`}
      actions={<Badge tone={STATUS_TONE[h.status]}>{h.status}</Badge>}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-bg-border bg-black/20 p-2 text-xs">
          <div className="text-muted">Stability Score</div>
          <div className="mt-1 font-mono">{h.stabilityScore === null ? "—" : h.stabilityScore.toFixed(2)}</div>
        </div>
        <div className="rounded border border-bg-border bg-black/20 p-2 text-xs">
          <div className="text-muted">Evaluable / Supporting</div>
          <div className="mt-1 font-mono">
            {h.evaluableSegments} / {h.supportingSegments}
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3">Segmento</th>
              <th className="py-1 pr-3">Ventana</th>
              <th className="py-1 pr-3">Candles</th>
              <th className="py-1 pr-3">Subgrupo: Trades/WinRate/PF/Exp/P&amp;L/DD</th>
              <th className="py-1 pr-3">Resto: Trades/WinRate/PF/Exp/P&amp;L/DD</th>
              <th className="py-1 pr-3">¿Dirección sostenida?</th>
            </tr>
          </thead>
          <tbody>
            {DISPLAY_ORDER.map((label) => {
              const seg = h.segments.find((s) => s.segment === label);
              if (!seg) return null;
              const c = seg.comparison;
              return (
                <tr key={label} className="border-t border-bg-border">
                  <td className="py-1.5 pr-3 font-medium">{label}</td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">
                    {new Date(seg.range.start).toLocaleDateString()} → {new Date(seg.range.end).toLocaleDateString()}
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{seg.candles}</td>
                  <td className={`py-1.5 pr-3 font-mono ${c.inGroup.insufficientSample ? "opacity-50" : ""}`}>
                    {c.inGroup.trades} / {(c.inGroup.winRate * 100).toFixed(0)}% / {fmtPf(c.inGroup.profitFactor)} / {c.inGroup.expectancy.toFixed(2)} / {c.inGroup.totalPnl.toFixed(2)} / {c.inGroup.maxDrawdown.toFixed(2)}
                    {c.inGroup.insufficientSample && <div className="text-[9px]">INSUFFICIENT SAMPLE</div>}
                  </td>
                  <td className={`py-1.5 pr-3 font-mono ${c.outGroup.insufficientSample ? "opacity-50" : ""}`}>
                    {c.outGroup.trades} / {(c.outGroup.winRate * 100).toFixed(0)}% / {fmtPf(c.outGroup.profitFactor)} / {c.outGroup.expectancy.toFixed(2)} / {c.outGroup.totalPnl.toFixed(2)} / {c.outGroup.maxDrawdown.toFixed(2)}
                  </td>
                  <td className="py-1.5 pr-3">{c.directionSupported === null ? <span className="text-muted">n/a</span> : c.directionSupported ? <span className="text-accent">sí</span> : <span className="text-danger">no</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MarketEventPanel({ event }: { event: MarketEventView }) {
  const classificationLabel: Record<MarketEventView["classification"], string> = {
    COMMON_MARKET_EVENT: "Evento común de mercado (afectó a todas las estrategias)",
    STRATEGY_SPECIFIC: "Específico de una estrategia",
    MIXED: "Mixto — no todas las estrategias reaccionaron igual",
    NO_OVERLAP: "Sin operaciones superpuestas a esta ventana",
  };
  return (
    <Card
      title="H5 — Evento de mercado común"
      subtitle={`${new Date(event.eventStart).toLocaleString()} → ${new Date(event.eventEnd).toLocaleString()}`}
      actions={<Badge tone={STATUS_TONE[event.status]}>{event.status}</Badge>}
    >
      <p className="text-xs text-muted">
        {classificationLabel[event.classification]} — {event.strategiesAffected}/{event.totalStrategies} estrategias con operaciones que se superponen a esta ventana.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3">Estrategia</th>
              <th className="py-1 pr-3">Trades</th>
              <th className="py-1 pr-3">P&amp;L</th>
              <th className="py-1 pr-3">Pérdidas</th>
              <th className="py-1 pr-3">Avg R</th>
              <th className="py-1 pr-3">Régimenes</th>
              <th className="py-1 pr-3">Volatilidad</th>
            </tr>
          </thead>
          <tbody>
            {event.byStrategy.map((s) => (
              <tr key={s.strategyId} className="border-t border-bg-border">
                <td className="py-1.5 pr-3 font-medium">{s.strategyName}</td>
                <td className="py-1.5 pr-3 font-mono">{s.tradesOverlapping}</td>
                <td className={`py-1.5 pr-3 font-mono ${s.totalPnl >= 0 ? "text-accent" : "text-danger"}`}>{s.totalPnl.toFixed(2)}</td>
                <td className="py-1.5 pr-3 font-mono">{s.losses}</td>
                <td className="py-1.5 pr-3 font-mono">{s.avgRMultiple === null ? "—" : s.avgRMultiple.toFixed(2)}</td>
                <td className="py-1.5 pr-3">
                  {s.regimesSeen.map((r) => (
                    <Badge key={r} tone={regimeTone(r)} className="mr-1">
                      {r}
                    </Badge>
                  ))}
                </td>
                <td className="py-1.5 pr-3 text-muted">{s.volatilityBucketsSeen.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {event.trades.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-200">Operaciones superpuestas ({event.trades.length})</summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-bg-card text-muted">
                <tr>
                  <th className="py-1 pr-3">Estrategia</th>
                  <th className="py-1 pr-3">Entrada</th>
                  <th className="py-1 pr-3">Salida</th>
                  <th className="py-1 pr-3">P&amp;L</th>
                  <th className="py-1 pr-3">R</th>
                  <th className="py-1 pr-3">Régimen</th>
                  <th className="py-1 pr-3">Exposición</th>
                </tr>
              </thead>
              <tbody>
                {event.trades.map((t, i) => (
                  <tr key={i} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3">{t.strategyName}</td>
                    <td className="py-1.5 pr-3 font-mono">{new Date(t.entryTime).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 font-mono">{new Date(t.exitTime).toLocaleString()}</td>
                    <td className={`py-1.5 pr-3 font-mono ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>{t.netPnl.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.rMultiple === null ? "—" : t.rMultiple.toFixed(2)}</td>
                    <td className="py-1.5 pr-3">{t.regime && <Badge tone={regimeTone(t.regime)}>{t.regime}</Badge>}</td>
                    <td className="py-1.5 pr-3 font-mono text-muted">{t.notionalExposure.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}

function WalkForwardPanel({ data }: { data: WalkForwardResponse }) {
  return (
    <Card title="Walk-Forward suplementario" subtitle={`Ventanas de ${data.options.windowSizeDays} días, paso ${data.options.stepDays} días, train ${(data.options.trainFraction * 100).toFixed(0)}%`}>
      <p className="text-[11px] text-muted">{data.note}</p>
      {data.strategies.map((s) => (
        <div key={s.strategyId} className="mt-3">
          <div className="text-xs font-medium text-slate-200">{s.strategyName}</div>
          {s.error ? (
            <p className="text-xs text-danger">{s.error}</p>
          ) : (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3">Window</th>
                    <th className="py-1 pr-3">Train Range</th>
                    <th className="py-1 pr-3">OOS Range</th>
                    <th className="py-1 pr-3">OOS Trades</th>
                    <th className="py-1 pr-3">OOS Return</th>
                    <th className="py-1 pr-3">OOS PF</th>
                    <th className="py-1 pr-3">Degraded</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.windows ?? []).map((w) => (
                    <tr key={w.windowIndex} className="border-t border-bg-border">
                      <td className="py-1.5 pr-3 font-mono">{w.windowIndex}</td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">
                        {new Date(w.trainRange[0]).toLocaleDateString()} → {new Date(w.trainRange[1]).toLocaleDateString()}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">
                        {new Date(w.oosRange[0]).toLocaleDateString()} → {new Date(w.oosRange[1]).toLocaleDateString()}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{w.oosMetrics.trades}</td>
                      <td className={`py-1.5 pr-3 font-mono ${w.oosMetrics.totalReturnPct >= 0 ? "text-accent" : "text-danger"}`}>{w.oosMetrics.totalReturnPct.toFixed(2)}%</td>
                      <td className="py-1.5 pr-3 font-mono">{fmtPf(w.oosMetrics.profitFactor)}</td>
                      <td className="py-1.5 pr-3">{w.degraded ? <Badge tone="warn">degraded</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.aggregateOosMetrics && (
                <p className="mt-1 text-[11px] text-muted">
                  Agregado OOS: avg return {s.aggregateOosMetrics.avgReturnPct.toFixed(2)}%, win rate de ventanas {(s.aggregateOosMetrics.winRateOfWindows * 100).toFixed(0)}%
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

/**
 * Fase 13 — Hypothesis Validation & Walk-Forward. Both underlying requests
 * re-run replays (in memory, nothing persisted) so — unlike Fase 12's
 * cheap DB-only regime-analysis — this section is explicitly opt-in via a
 * button rather than auto-fetched on mount.
 */
export function HypothesisValidationSection({ benchmarkRunId }: { benchmarkRunId: string }) {
  const [data, setData] = useState<HypothesisValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [wfData, setWfData] = useState<WalkForwardResponse | null>(null);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/strategy-benchmark/${benchmarkRunId}/hypothesis-validation`, { method: "POST", body: JSON.stringify({}) });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "No se pudo ejecutar la validación de hipótesis.");
        return;
      }
      setData(json);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }

  async function runWalkForward() {
    setWfLoading(true);
    setWfError(null);
    try {
      const res = await fetch(`/api/strategy-benchmark/${benchmarkRunId}/hypothesis-validation/walk-forward`, { method: "POST", body: JSON.stringify({}) });
      const json = await res.json();
      if (!json.ok) {
        setWfError(json.error ?? "No se pudo ejecutar el walk-forward suplementario.");
        return;
      }
      setWfData(json);
    } finally {
      setWfLoading(false);
    }
  }

  const selected = data?.hypotheses.find((h) => h.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Hypothesis Validation"
        subtitle="Fase 13 — ¿Las hipótesis de Fase 12 se sostienen fuera del segmento donde se observaron? OOS se muestra primero."
        actions={
          <button onClick={run} disabled={loading} className="rounded border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
            {loading ? "Ejecutando (IS/VALIDATION/OOS × 4 estrategias)…" : "Run Hypothesis Validation"}
          </button>
        }
      >
        {error && <p className="text-xs text-danger">{error}</p>}
        {!data && !loading && !error && <p className="text-xs text-muted">No ejecutado todavía en esta sesión — no se re-ejecuta un replay hasta que lo pidas explícitamente.</p>}

        {data && (
          <>
            <div className="mb-3 grid grid-cols-1 gap-2 text-[11px] text-muted sm:grid-cols-3">
              <div>
                IS: {new Date(data.segmentRanges.is.start).toLocaleDateString()} → {new Date(data.segmentRanges.is.end).toLocaleDateString()}
              </div>
              <div>
                VALIDATION: {new Date(data.segmentRanges.validation.start).toLocaleDateString()} → {new Date(data.segmentRanges.validation.end).toLocaleDateString()}
              </div>
              <div>
                OOS: {new Date(data.segmentRanges.oos.start).toLocaleDateString()} → {new Date(data.segmentRanges.oos.end).toLocaleDateString()}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3">Hypothesis</th>
                    <th className="py-1 pr-3">Strategy</th>
                    <th className="py-1 pr-3">OOS</th>
                    <th className="py-1 pr-3">Validation</th>
                    <th className="py-1 pr-3">IS</th>
                    <th className="py-1 pr-3">Stability</th>
                    <th className="py-1 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hypotheses.map((h) => (
                    <tr key={h.id} onClick={() => setSelectedId(h.id)} className={`cursor-pointer border-t border-bg-border hover:bg-white/5 ${selectedId === h.id ? "bg-white/5" : ""}`}>
                      <td className="py-1.5 pr-3 font-medium">{h.description}</td>
                      <td className="py-1.5 pr-3 text-muted">{h.strategyName}</td>
                      <SegmentCell seg={h.segments.find((s) => s.segment === "OOS")} />
                      <SegmentCell seg={h.segments.find((s) => s.segment === "VALIDATION")} />
                      <SegmentCell seg={h.segments.find((s) => s.segment === "IS")} />
                      <td className="py-1.5 pr-3 font-mono">{h.stabilityScore === null ? "—" : h.stabilityScore.toFixed(2)}</td>
                      <td className="py-1.5 pr-3">
                        <Badge tone={STATUS_TONE[h.status]}>{h.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted">{data.stabilityScoreFormula} Haz clic en una fila para ver el detalle por segmento.</p>
          </>
        )}
      </Card>

      {selected && <HypothesisDetail h={selected} />}
      {data && <MarketEventPanel event={data.marketEvent} />}

      <Card
        title="Walk-Forward suplementario (spec sección 4)"
        actions={
          <button onClick={runWalkForward} disabled={wfLoading} className="rounded border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
            {wfLoading ? "Ejecutando…" : "Run Walk-Forward"}
          </button>
        }
      >
        {wfError && <p className="text-xs text-danger">{wfError}</p>}
        {!wfData && !wfLoading && !wfError && <p className="text-xs text-muted">Opcional — ventanas múltiples train/OOS, sin desglosar por régimen (ver nota tras ejecutarlo).</p>}
      </Card>
      {wfData && <WalkForwardPanel data={wfData} />}
    </div>
  );
}
