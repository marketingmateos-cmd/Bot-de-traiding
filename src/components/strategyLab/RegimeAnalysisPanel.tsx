"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge, regimeTone, verdictTone } from "@/components/ui/Badge";
import { tExitReason } from "@/lib/i18n";
import type { BucketStats, LossAnalysis, ExitAnalysis, RegimeAnalysis, StrategyRegimeMatrixCell } from "@/lib/research/regimeAnalysis";
import type { ReplayRobustnessReport } from "@/lib/replay/replayRobustness";
import type { ReplayMetrics } from "@/lib/replay/types";
import type { OverfittingReport } from "@/lib/engines/overfitting";

interface StrategyRegimeView {
  strategyId: string;
  strategyName: string;
  strategyVersion: string;
  replayRunId: string;
  evaluationStatus: string;
  regimeAnalysis: RegimeAnalysis;
  robustness: ReplayRobustnessReport | null;
  overfitting: OverfittingReport | null;
}

interface RegimeAnalysisResponse {
  ok: boolean;
  error?: string;
  benchmarkRunId: string;
  strategies: StrategyRegimeView[];
  strategyRegimeMatrix: StrategyRegimeMatrixCell[];
}

interface StabilitySegment {
  metrics: ReplayMetrics;
  regimeAnalysis: RegimeAnalysis;
}

interface StabilityStrategyView {
  strategyId: string;
  strategyName: string;
  error?: string;
  ranges?: { is: { start: string; end: string }; validation: { start: string; end: string }; oos: { start: string; end: string } };
  is?: StabilitySegment;
  validation?: StabilitySegment;
  oos?: StabilitySegment;
}

const WEEKDAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
function fmtPf(pf: number | null): string {
  return pf === null ? "—" : pf.toFixed(2);
}

/** One generic Bucket->BucketStats table — every per-axis table (regime/direction/volatility/hour/weekday) is the same shape, spec section 10 requires the SAME insufficient-sample flag on every one of them. */
function BucketTable({ title, stats, labelFor, order }: { title: string; stats: Record<string, BucketStats>; labelFor?: (key: string) => string; order?: string[] }) {
  const keys = order ?? Object.keys(stats).sort();
  if (keys.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium text-slate-200">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3">Bucket</th>
              <th className="py-1 pr-3">Trades</th>
              <th className="py-1 pr-3">Win Rate</th>
              <th className="py-1 pr-3">P&amp;L</th>
              <th className="py-1 pr-3">Expectancy</th>
              <th className="py-1 pr-3">PF</th>
              <th className="py-1 pr-3">Avg Trade</th>
              <th className="py-1 pr-3">Max DD</th>
              <th className="py-1 pr-3">Losing Streak</th>
              <th className="py-1 pr-3">Avg Hold</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const s = stats[key];
              if (!s) return null;
              return (
                <tr key={key} className={`border-t border-bg-border ${s.insufficientSample ? "opacity-50" : ""}`}>
                  <td className="py-1.5 pr-3 font-medium">{labelFor ? labelFor(key) : key}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.trades}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmtPct(s.winRate)}</td>
                  <td className={`py-1.5 pr-3 font-mono ${s.totalPnl >= 0 ? "text-accent" : "text-danger"}`}>{s.totalPnl.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.expectancy.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmtPf(s.profitFactor)}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.avgTrade.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.maxDrawdown.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.longestLossStreak}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.avgHoldingTimeHours.toFixed(1)}h</td>
                  <td className="py-1.5 pr-3">{s.insufficientSample && <Badge tone="muted">INSUFFICIENT SAMPLE</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LossAnalysisView({ loss }: { loss: LossAnalysis }) {
  const streakEntries = Object.entries(loss.losingStreakDistribution)
    .map(([len, count]) => ({ len: Number(len), count }))
    .sort((a, b) => a.len - b.len);
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium text-slate-200">Loss Analysis</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-bg-border bg-black/20 p-2 text-xs">
          <div className="text-muted">Max Losing Streak</div>
          <div className="mt-1 font-mono text-danger">{loss.maxLosingStreak}</div>
        </div>
        <div className="rounded border border-bg-border bg-black/20 p-2 text-xs">
          <div className="text-muted">Avg R-Multiple</div>
          <div className="mt-1 font-mono">{loss.avgRMultiple === null ? "—" : loss.avgRMultiple.toFixed(2)}</div>
        </div>
        <div className="rounded border border-bg-border bg-black/20 p-2 text-xs">
          <div className="text-muted">Median R-Multiple</div>
          <div className="mt-1 font-mono">{loss.medianRMultiple === null ? "—" : loss.medianRMultiple.toFixed(2)}</div>
        </div>
        <div className="rounded border border-bg-border bg-black/20 p-2 text-xs">
          <div className="text-muted">Losing Streak Distribution</div>
          <div className="mt-1 font-mono">{streakEntries.length === 0 ? "—" : streakEntries.map((e) => `${e.len}×:${e.count}`).join(" ")}</div>
        </div>
      </div>

      {loss.largestLosses.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3">Entrada</th>
                <th className="py-1 pr-3">Salida</th>
                <th className="py-1 pr-3">P&amp;L</th>
                <th className="py-1 pr-3">R</th>
                <th className="py-1 pr-3">Régimen</th>
                <th className="py-1 pr-3">Volatilidad</th>
                <th className="py-1 pr-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {loss.largestLosses.map((t, i) => (
                <tr key={i} className="border-t border-bg-border">
                  <td className="py-1.5 pr-3 font-mono">{new Date(t.entryTime).toLocaleString()}</td>
                  <td className="py-1.5 pr-3 font-mono">{new Date(t.exitTime).toLocaleString()}</td>
                  <td className="py-1.5 pr-3 font-mono text-danger">{t.netPnl.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{t.rMultiple === null ? "—" : t.rMultiple.toFixed(2)}</td>
                  <td className="py-1.5 pr-3">{t.regime && <Badge tone={regimeTone(t.regime)}>{t.regime}</Badge>}</td>
                  <td className="py-1.5 pr-3">{t.volatilityBucket}</td>
                  <td className="py-1.5 pr-3 text-muted">{tExitReason(t.exitReason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExitAnalysisView({ exit }: { exit: ExitAnalysis }) {
  const reasons = Object.keys(exit.byExitReason).sort();
  if (reasons.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium text-slate-200">Exit Analysis</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3">Motivo</th>
              <th className="py-1 pr-3">Count</th>
              <th className="py-1 pr-3">Total P&amp;L</th>
              <th className="py-1 pr-3">Avg P&amp;L</th>
              <th className="py-1 pr-3">Por régimen</th>
            </tr>
          </thead>
          <tbody>
            {reasons.map((reason) => {
              const s = exit.byExitReason[reason];
              const byRegime = exit.byExitReasonAndRegime[reason] ?? {};
              return (
                <tr key={reason} className="border-t border-bg-border">
                  <td className="py-1.5 pr-3 font-medium">{tExitReason(reason)}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.count}</td>
                  <td className={`py-1.5 pr-3 font-mono ${s.totalPnl >= 0 ? "text-accent" : "text-danger"}`}>{s.totalPnl.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{s.avgPnl.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 text-muted">
                    {Object.entries(byRegime)
                      .map(([regime, count]) => `${regime}:${count}`)
                      .join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StabilityCheckView({ view }: { view: StabilityStrategyView }) {
  if (view.error) return <p className="mt-2 text-xs text-danger">{view.error}</p>;
  const segments: { label: string; seg?: StabilitySegment }[] = [
    { label: "IS", seg: view.is },
    { label: "VALIDATION", seg: view.validation },
    { label: "OOS", seg: view.oos },
  ];
  const regimeKeys = Array.from(new Set(segments.flatMap((s) => Object.keys(s.seg?.regimeAnalysis.byRegime ?? {})))).sort();

  return (
    <div className="mt-3">
      <p className="text-[11px] text-muted">
        Misma estrategia baseline, mismos parámetros — solo se divide el período en tres ventanas independientes (IS 0-60%, VALIDATION 60-80%, OOS
        80-100%) para observar si los patrones por régimen se repiten. No es optimización ni una segunda estrategia.
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {segments.map(({ label, seg }) => (
          <div key={label} className="rounded border border-bg-border bg-black/20 p-2 text-xs">
            <div className="font-semibold text-slate-200">{label}</div>
            {seg ? (
              <>
                <div className="mt-1 text-muted">
                  Trades: <span className="font-mono text-slate-200">{seg.regimeAnalysis.totalTrades}</span>
                </div>
                <div className="text-muted">
                  Return: <span className={`font-mono ${seg.metrics.totalReturnPct >= 0 ? "text-accent" : "text-danger"}`}>{seg.metrics.totalReturnPct.toFixed(2)}%</span>
                </div>
                <div className="text-muted">
                  PF: <span className="font-mono text-slate-200">{fmtPf(seg.metrics.profitFactor)}</span>
                </div>
              </>
            ) : (
              <div className="mt-1 text-muted">—</div>
            )}
          </div>
        ))}
      </div>

      {regimeKeys.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3">Régimen</th>
                {segments.map((s) => (
                  <th key={s.label} className="py-1 pr-3" colSpan={2}>
                    {s.label} (Trades / PF)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regimeKeys.map((regime) => (
                <tr key={regime} className="border-t border-bg-border">
                  <td className="py-1.5 pr-3">
                    <Badge tone={regimeTone(regime)}>{regime}</Badge>
                  </td>
                  {segments.map((s) => {
                    const bucket = s.seg?.regimeAnalysis.byRegime[regime];
                    return (
                      <td key={s.label} colSpan={2} className={`py-1.5 pr-3 font-mono ${bucket?.insufficientSample ? "opacity-50" : ""}`}>
                        {bucket ? `${bucket.trades} / ${fmtPf(bucket.profitFactor)}` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StrategyRegimeMatrixView({ matrix }: { matrix: StrategyRegimeMatrixCell[] }) {
  const strategyNames = Array.from(new Map(matrix.map((c) => [c.strategyId, c.strategyName])).entries());
  const regimes = Array.from(new Set(matrix.map((c) => c.regime))).sort();
  const cellFor = (strategyId: string, regime: string) => matrix.find((c) => c.strategyId === strategyId && c.regime === regime);

  if (strategyNames.length === 0 || regimes.length === 0) return null;
  return (
    <Card title="Strategy × Regime Matrix" subtitle="Cada celda: Trades / Profit Factor / Expectancy — celdas con muestra insuficiente aparecen atenuadas y marcadas.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3">Estrategia</th>
              {regimes.map((r) => (
                <th key={r} className="py-1 pr-3">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strategyNames.map(([strategyId, strategyName]) => (
              <tr key={strategyId} className="border-t border-bg-border">
                <td className="py-1.5 pr-3 font-medium">{strategyName}</td>
                {regimes.map((regime) => {
                  const cell = cellFor(strategyId, regime);
                  if (!cell) return <td key={regime} className="py-1.5 pr-3 text-muted">—</td>;
                  return (
                    <td key={regime} className={`py-1.5 pr-3 font-mono ${cell.insufficientSample ? "opacity-50" : ""}`}>
                      {cell.trades} / {fmtPf(cell.profitFactor)} / {cell.expectancy.toFixed(2)}
                      {cell.insufficientSample && <span className="ml-1 text-[9px] text-muted">(insuf.)</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Fase 12 — Regime Analysis section for /strategy-lab. Fetches the
 * on-demand `regime-analysis` route once per benchmark run (pure
 * post-processing of already-persisted trades/decisions, spec sections
 * 1-10), and offers an opt-in "Run Stability Check" per strategy (spec
 * section 11) that reuses the existing IS/VALIDATION/OOS replay
 * infrastructure — never a second strategy, never a parameter change.
 */
export function RegimeAnalysisSection({ benchmarkRunId, selectedStrategyId }: { benchmarkRunId: string; selectedStrategyId: string | null }) {
  const [data, setData] = useState<RegimeAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stability, setStability] = useState<Record<string, StabilityStrategyView>>({});
  const [stabilityLoading, setStabilityLoading] = useState(false);
  const [stabilityError, setStabilityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/strategy-benchmark/${benchmarkRunId}/regime-analysis`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? "No se pudo cargar el análisis por régimen.");
          return;
        }
        setData(json);
      })
      .catch(() => !cancelled && setError("No se pudo cargar el análisis por régimen."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [benchmarkRunId]);

  async function runStabilityCheck(strategyId: string) {
    setStabilityLoading(true);
    setStabilityError(null);
    try {
      const res = await fetch(`/api/strategy-benchmark/${benchmarkRunId}/stability-check`, {
        method: "POST",
        body: JSON.stringify({ strategyIds: [strategyId] }),
      });
      const json = await res.json();
      if (!json.ok) {
        setStabilityError(json.error ?? "No se pudo ejecutar el stability check.");
        return;
      }
      const view = (json.strategies as StabilityStrategyView[]).find((s) => s.strategyId === strategyId);
      if (view) setStability((prev) => ({ ...prev, [strategyId]: view }));
    } finally {
      setStabilityLoading(false);
    }
  }

  if (loading) return <Card title="Regime Analysis"><p className="text-xs text-muted">Calculando análisis por régimen…</p></Card>;
  if (error) return <Card title="Regime Analysis" className="border-danger/40 bg-danger/5"><p className="text-xs text-danger">{error}</p></Card>;
  if (!data) return null;

  const selected = selectedStrategyId ? data.strategies.find((s) => s.strategyId === selectedStrategyId) : null;

  return (
    <div className="flex flex-col gap-4">
      <StrategyRegimeMatrixView matrix={data.strategyRegimeMatrix} />

      {selected && (
        <Card
          title={`Regime Analysis — ${selected.strategyName}`}
          subtitle="Análisis descriptivo sobre operaciones ya simuladas — sin re-ejecutar el motor de régimen, sin modificar la estrategia."
          actions={
            <div className="flex items-center gap-2">
              {selected.robustness && <Badge tone={verdictTone(selected.robustness.classification)}>{selected.robustness.classification}</Badge>}
              {selected.overfitting && <Badge tone={verdictTone(selected.overfitting.risk === "LOW" ? "ROBUST" : selected.overfitting.risk === "HIGH" ? "HIGH_RISK" : "MEDIUM")}>Overfitting: {selected.overfitting.risk}</Badge>}
            </div>
          }
        >
          <BucketTable title="Por Régimen" stats={selected.regimeAnalysis.byRegime} />
          <BucketTable title="Long vs Short" stats={selected.regimeAnalysis.byDirection} />
          <BucketTable title="Por Volatilidad" stats={selected.regimeAnalysis.byVolatility} />
          <BucketTable
            title="Por Hora (UTC)"
            stats={selected.regimeAnalysis.byHourUtc}
            order={Array.from({ length: 24 }, (_, h) => String(h)).filter((h) => selected.regimeAnalysis.byHourUtc[h])}
            labelFor={(h) => `${h}:00`}
          />
          <BucketTable
            title="Por Día de la Semana"
            stats={selected.regimeAnalysis.byWeekday}
            order={Array.from({ length: 7 }, (_, d) => String(d)).filter((d) => selected.regimeAnalysis.byWeekday[d])}
            labelFor={(d) => WEEKDAY_NAMES[Number(d)] ?? d}
          />
          <LossAnalysisView loss={selected.regimeAnalysis.lossAnalysis} />
          <ExitAnalysisView exit={selected.regimeAnalysis.exitAnalysis} />

          <div className="mt-4 border-t border-bg-border pt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Stability Check (IS / VALIDATION / OOS)</div>
              <button
                onClick={() => runStabilityCheck(selected.strategyId)}
                disabled={stabilityLoading}
                className="rounded border border-accent bg-accent/10 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {stabilityLoading ? "Ejecutando…" : "Run Stability Check"}
              </button>
            </div>
            {stabilityError && <p className="mt-2 text-xs text-danger">{stabilityError}</p>}
            {stability[selected.strategyId] && <StabilityCheckView view={stability[selected.strategyId]} />}
          </div>
        </Card>
      )}
    </div>
  );
}
