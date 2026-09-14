"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { StatTile } from "@/components/ui/StatTile";
import { EquityCurveChart } from "@/components/charts/EquityCurveChart";
import { DrawdownCurveChart } from "@/components/charts/DrawdownCurveChart";
import { RegimeAnalysisSection } from "@/components/strategyLab/RegimeAnalysisPanel";
import { HypothesisValidationSection } from "@/components/strategyLab/HypothesisValidationPanel";
import { tDirection, tExitReason } from "@/lib/i18n";
import type { TimeframeCode } from "@/lib/providers/types";
import type { StrategyBenchmarkMetrics } from "@/lib/research/benchmarkMetrics";
import type { BenchmarkScoreBreakdown } from "@/lib/research/benchmarkScore";
import type { ReplayTradeRecord } from "@/lib/replay/types";

interface StrategyMeta {
  id: string;
  name: string;
  version: string;
  defaultParams: Record<string, number | string | boolean>;
}

interface StrategyBenchmarkResultView {
  strategyId: string;
  strategyName: string;
  strategyVersion: string;
  strategyConfigHash: string;
  replayRunId: string;
  metrics: StrategyBenchmarkMetrics;
  evaluationStatus: "PASS" | "FAIL" | "INCONCLUSIVE";
  score: BenchmarkScoreBreakdown;
  equityCurve: { t: number; equity: number }[];
  drawdownCurve: { t: number; drawdownPct: number }[];
  trades: ReplayTradeRecord[];
}

interface BenchmarkRunView {
  id: string;
  datasetSymbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  evaluationProfileType: string;
  riskLevel: number;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
  createdAt: string;
  results: StrategyBenchmarkResultView[];
}

interface RunListItem {
  id: string;
  datasetSymbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  status: string;
  createdAt: string;
  resultsCount: number;
}

const EVALUATION_TONE: Record<string, BadgeTone> = { PASS: "success", FAIL: "danger", INCONCLUSIVE: "muted" };

type SortField = "score" | "return" | "profitFactor" | "expectancy" | "maxDrawdown" | "days" | "evaluationStatus";
const SORT_LABELS: Record<SortField, string> = {
  score: "Score",
  return: "Return",
  profitFactor: "Profit Factor",
  expectancy: "Expectancy",
  maxDrawdown: "Max Drawdown",
  days: "Días a Target",
  evaluationStatus: "Evaluation Status",
};

function sortValue(r: StrategyBenchmarkResultView, field: SortField): number {
  switch (field) {
    case "score":
      return r.score.score;
    case "return":
      return r.metrics.performance.totalReturnPct;
    case "profitFactor":
      return r.metrics.performance.profitFactor ?? -Infinity;
    case "expectancy":
      return r.metrics.performance.expectancy;
    case "maxDrawdown":
      return -r.metrics.risk.maxDrawdownPct; // ascending drawdown = better, so negate for a consistent "higher is better" sort
    case "days":
      return -(r.metrics.evaluation.daysToTarget ?? Infinity); // fewer days is better
    case "evaluationStatus": {
      const rank = { PASS: 2, INCONCLUSIVE: 1, FAIL: 0 } as const;
      return rank[r.evaluationStatus];
    }
  }
}

export function StrategyLabForm({ assetSymbols, strategies }: { assetSymbols: string[]; strategies: StrategyMeta[] }) {
  const [datasetSymbol, setDatasetSymbol] = useState(assetSymbols.includes("BTC") ? "BTC" : assetSymbols[0] ?? "BTC");
  const [timeframe] = useState<TimeframeCode>("H1");
  const [startDate, setStartDate] = useState("2026-03-01");
  const [endDate, setEndDate] = useState("2026-08-31");
  const [evaluationProfileType, setEvaluationProfileType] = useState<"20K" | "50K" | "100K" | "CUSTOM">("20K");
  const [customBalance, setCustomBalance] = useState("10000");
  const [riskLevel, setRiskLevel] = useState(5);
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>(strategies.map((s) => s.id));

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<BenchmarkRunView | null>(null);
  const [pastRuns, setPastRuns] = useState<RunListItem[]>([]);
  const [sortField, setSortField] = useState<SortField>("score");
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);

  async function refreshPastRuns() {
    const res = await fetch("/api/strategy-benchmark");
    const json = await res.json();
    if (json.ok) setPastRuns(json.runs);
  }

  useEffect(() => {
    refreshPastRuns();
  }, []);

  function toggleStrategy(id: string) {
    setSelectedStrategyIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function loadRun(id: string) {
    const res = await fetch(`/api/strategy-benchmark/${id}`);
    const json = await res.json();
    if (json.ok) {
      setRun(json.run);
      setSelectedStrategyId(null);
    }
  }

  async function runBenchmark() {
    setRunning(true);
    setError(null);
    setRun(null);
    setSelectedStrategyId(null);
    try {
      const body: Record<string, unknown> = {
        datasetSymbol,
        timeframe,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        evaluationProfileType,
        riskLevel,
        strategyIds: selectedStrategyIds,
        // This screen is exclusively for real historical evidence (spec
        // section 2/24) — never exposed as a picker, so a user can never
        // accidentally compare strategies against synthetic data here.
        dataSource: "HISTORICAL_REAL",
      };
      if (evaluationProfileType === "CUSTOM") body.customEvaluation = { initialBalance: Number(customBalance) };

      const res = await fetch("/api/strategy-benchmark", { method: "POST", body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "No se pudo ejecutar el benchmark.");
        return;
      }
      await loadRun(json.benchmarkRunId);
      await refreshPastRuns();
    } finally {
      setRunning(false);
    }
  }

  const sortedResults = run ? [...run.results].sort((a, b) => sortValue(b, sortField) - sortValue(a, sortField)) : [];
  const selectedResult = run?.results.find((r) => r.strategyId === selectedStrategyId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Card title="Configuración">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-slate-300">Dataset</div>
            <select value={datasetSymbol} onChange={(e) => setDatasetSymbol(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100">
              {assetSymbols.map((s) => (
                <option key={s} value={s}>
                  {s} {timeframe}
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
            <div className="text-xs text-slate-300">Evaluation Profile</div>
            <select
              value={evaluationProfileType}
              onChange={(e) => setEvaluationProfileType(e.target.value as typeof evaluationProfileType)}
              className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
            >
              <option value="20K">20K — Phase 1 (+10%)</option>
              <option value="50K">50K — Phase 1 (+10%)</option>
              <option value="100K">100K — Phase 1 (+10%)</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </div>
          {evaluationProfileType === "CUSTOM" && (
            <div>
              <div className="text-xs text-slate-300">Balance inicial (CUSTOM)</div>
              <input type="number" value={customBalance} onChange={(e) => setCustomBalance(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm font-mono text-slate-100" />
            </div>
          )}
          <div>
            <div className="text-xs text-slate-300">Risk Level: {riskLevel}/10</div>
            <input type="range" min={1} max={10} value={riskLevel} onChange={(e) => setRiskLevel(Number(e.target.value))} className="mt-2 w-full accent-accent" />
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs text-slate-300">Estrategias</div>
          <div className="mt-2 flex flex-wrap gap-3">
            {strategies.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded border border-bg-border bg-black/20 px-2 py-1.5 text-xs text-slate-200">
                <input type="checkbox" checked={selectedStrategyIds.includes(s.id)} onChange={() => toggleStrategy(s.id)} className="accent-accent" />
                {s.name}
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={runBenchmark}
          disabled={running || selectedStrategyIds.length === 0}
          className="mt-4 rounded border border-accent bg-accent/10 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {running ? `EJECUTANDO BENCHMARK... (${selectedStrategyIds.length} estrategia(s), puede tardar varios minutos)` : "RUN BENCHMARK"}
        </button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      {pastRuns.length > 0 && !run && (
        <Card title="Benchmarks anteriores">
          <div className="flex flex-col gap-2">
            {pastRuns.map((r) => (
              <button
                key={r.id}
                onClick={() => loadRun(r.id)}
                className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-left text-xs hover:bg-white/5"
              >
                <span>
                  {r.datasetSymbol} {r.timeframe} — {new Date(r.startDate).toLocaleDateString()} → {new Date(r.endDate).toLocaleDateString()} ({r.resultsCount} estrategia(s))
                </span>
                <Badge tone={r.status === "DONE" ? "success" : r.status === "FAILED" ? "danger" : "muted"}>{r.status}</Badge>
              </button>
            ))}
          </div>
        </Card>
      )}

      {run && run.status === "FAILED" && (
        <Card title="Benchmark fallido" className="border-danger/40 bg-danger/5">
          <p className="text-sm text-danger">{run.error}</p>
        </Card>
      )}

      {run && run.status === "DONE" && (
        <>
          <Card className="border-warn/40 bg-warn/5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="success">REAL HISTORICAL DATA</Badge>
              <Badge tone="info">PAPER REPLAY</Badge>
              <Badge tone="muted">BASELINE STRATEGY</Badge>
              <Badge tone="warn">NOT OPTIMIZED</Badge>
              <Badge tone="danger">NO LIVE TRADING</Badge>
            </div>
            <p className="mt-2 text-xs text-slate-300">
              Estos resultados NO son evidencia de que exista un edge real, ni de que ninguna estrategia sea rentable en general, ni de que vaya a
              funcionar en el futuro. Son una única trayectoria histórica (spec sección 16) — la probabilidad de superar una evaluación real requiere
              Monte Carlo / bootstrap sobre múltiples trayectorias, no implementado en esta fase.
            </p>
          </Card>

          <Card
            title="Comparison Table"
            subtitle={`${run.datasetSymbol} ${run.timeframe} — ${new Date(run.startDate).toLocaleDateString()} → ${new Date(run.endDate).toLocaleDateString()} — ${run.evaluationProfileType}`}
            actions={
              <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} className="rounded border border-bg-border bg-black/20 px-2 py-1 text-xs text-slate-100">
                {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
                  <option key={f} value={f}>
                    Ordenar por: {SORT_LABELS[f]}
                  </option>
                ))}
              </select>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3">Strategy</th>
                    <th className="py-1 pr-3">Trades</th>
                    <th className="py-1 pr-3">Return</th>
                    <th className="py-1 pr-3">Profit Factor</th>
                    <th className="py-1 pr-3">Expectancy</th>
                    <th className="py-1 pr-3">Win Rate</th>
                    <th className="py-1 pr-3">Max DD</th>
                    <th className="py-1 pr-3">Max Daily DD</th>
                    <th className="py-1 pr-3">Losing Streak</th>
                    <th className="py-1 pr-3">Days</th>
                    <th className="py-1 pr-3">Target</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((r) => (
                    <tr
                      key={r.strategyId}
                      onClick={() => setSelectedStrategyId(r.strategyId)}
                      className={`cursor-pointer border-t border-bg-border hover:bg-white/5 ${selectedStrategyId === r.strategyId ? "bg-white/5" : ""}`}
                    >
                      <td className="py-1.5 pr-3 font-medium">{r.strategyName}</td>
                      <td className="py-1.5 pr-3 font-mono">{r.metrics.execution.trades}</td>
                      <td className={`py-1.5 pr-3 font-mono ${r.metrics.performance.totalReturnPct >= 0 ? "text-accent" : "text-danger"}`}>
                        {r.metrics.performance.totalReturnPct >= 0 ? "+" : ""}
                        {r.metrics.performance.totalReturnPct.toFixed(2)}%
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{r.metrics.performance.profitFactor === null ? "—" : r.metrics.performance.profitFactor.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 font-mono">{r.metrics.performance.expectancy.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 font-mono">{(r.metrics.performance.winRate * 100).toFixed(0)}%</td>
                      <td className="py-1.5 pr-3 font-mono">{r.metrics.risk.maxDrawdownPct.toFixed(1)}%</td>
                      <td className="py-1.5 pr-3 font-mono">{r.metrics.risk.maxDailyDrawdownPct.toFixed(2)}%</td>
                      <td className="py-1.5 pr-3 font-mono">{r.metrics.risk.longestLossStreak}</td>
                      <td className="py-1.5 pr-3 font-mono">{r.metrics.evaluation.daysToTarget ?? r.metrics.evaluation.daysUntilFailure ?? "—"}</td>
                      <td className="py-1.5 pr-3">{r.metrics.evaluation.targetReached ? "✓" : "—"}</td>
                      <td className="py-1.5 pr-3">
                        <Badge tone={EVALUATION_TONE[r.evaluationStatus]}>{r.evaluationStatus}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{r.score.score.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Score = herramienta de clasificación únicamente (fórmula: {sortedResults[0]?.score.formula ?? ""}) — nunca usado para optimizar
              parámetros. Haz clic en una fila para ver el detalle.
            </p>
          </Card>

          {selectedResult && <StrategyDetail result={selectedResult} />}

          <RegimeAnalysisSection benchmarkRunId={run.id} selectedStrategyId={selectedStrategyId} />

          <HypothesisValidationSection benchmarkRunId={run.id} />
        </>
      )}
    </div>
  );
}

function StrategyDetail({ result }: { result: StrategyBenchmarkResultView }) {
  const m = result.metrics;
  return (
    <Card
      title={`Detalle — ${result.strategyName}`}
      subtitle={`v${result.strategyVersion} · configHash ${result.strategyConfigHash} · replayRunId ${result.replayRunId}`}
      actions={<Badge tone={EVALUATION_TONE[result.evaluationStatus]}>{result.evaluationStatus}</Badge>}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <StatTile label="Total Return" value={`${m.performance.totalReturnPct >= 0 ? "+" : ""}${m.performance.totalReturnPct.toFixed(2)}%`} tone={m.performance.totalReturnPct >= 0 ? "positive" : "negative"} />
        <StatTile label="Final Equity" value={m.performance.finalEquity.toFixed(2)} />
        <StatTile label="Total P&L" value={m.performance.totalPnl.toFixed(2)} tone={m.performance.totalPnl >= 0 ? "positive" : "negative"} />
        <StatTile label="Profit Factor" value={m.performance.profitFactor === null ? "—" : m.performance.profitFactor.toFixed(2)} />
        <StatTile label="Expectancy" value={m.performance.expectancy.toFixed(2)} tone={m.performance.expectancy >= 0 ? "positive" : "negative"} />
        <StatTile label="Win Rate" value={`${(m.performance.winRate * 100).toFixed(0)}%`} />
        <StatTile label="Max Drawdown" value={`${m.risk.maxDrawdownPct.toFixed(1)}%`} tone={m.risk.maxDrawdownPct > 15 ? "negative" : "neutral"} />
        <StatTile label="Max Daily DD" value={`${m.risk.maxDailyDrawdownPct.toFixed(2)}%`} />
        <StatTile label="Max Exposure" value={m.risk.maxExposurePct === null ? "—" : `${m.risk.maxExposurePct.toFixed(1)}%`} />
        <StatTile label="Avg Exposure" value={m.risk.avgExposurePct === null ? "—" : `${m.risk.avgExposurePct.toFixed(1)}%`} />
        <StatTile label="Winning Streak" value={m.risk.longestWinStreak} />
        <StatTile label="Losing Streak" value={m.risk.longestLossStreak} />
        <StatTile label="Trades" value={m.execution.trades} />
        <StatTile label="Avg Trade" value={m.execution.avgTrade.toFixed(2)} />
        <StatTile label="Avg RRR" value={m.execution.avgRrr === null ? "—" : m.execution.avgRrr.toFixed(2)} />
        <StatTile label="Avg Holding Time" value={m.execution.avgHoldingTimeHours === null ? "—" : `${m.execution.avgHoldingTimeHours.toFixed(1)}h`} />
      </div>

      <div className="mt-4 rounded border border-bg-border bg-black/20 p-3 text-xs">
        <div className="font-semibold text-slate-200">Evaluation ({result.evaluationStatus})</div>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <span className="text-muted">Target Reached:</span> {m.evaluation.targetReached ? "SÍ" : "no"}
          </div>
          <div>
            <span className="text-muted">Failed:</span> {m.evaluation.failed ? "SÍ" : "no"}
          </div>
          <div>
            <span className="text-muted">Days to Target:</span> {m.evaluation.daysToTarget ?? "—"}
          </div>
          <div>
            <span className="text-muted">Days Until Failure:</span> {m.evaluation.daysUntilFailure ?? "—"}
          </div>
          <div>
            <span className="text-muted">Daily Stop Triggered:</span> {m.evaluation.dailyStopTriggered ? "SÍ" : "no"}
          </div>
          <div>
            <span className="text-muted">Total Stop Triggered:</span> {m.evaluation.totalStopTriggered ? "SÍ" : "no"}
          </div>
        </div>
        {m.evaluation.failureReason && <p className="mt-2 text-danger">{m.evaluation.failureReason}</p>}
      </div>

      {result.equityCurve.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-slate-200">Equity Curve</div>
          <EquityCurveChart data={result.equityCurve} />
        </div>
      )}
      {result.drawdownCurve.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-slate-200">Drawdown Curve</div>
          <DrawdownCurveChart data={result.drawdownCurve} />
        </div>
      )}

      {result.trades.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-200">Operaciones ({result.trades.length})</summary>
          <div className="mt-2 max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-bg-card text-muted">
                <tr>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entrada</th>
                  <th className="py-1 pr-3">Salida</th>
                  <th className="py-1 pr-3">SL</th>
                  <th className="py-1 pr-3">TP</th>
                  <th className="py-1 pr-3">P&L Neto</th>
                  <th className="py-1 pr-3">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t, i) => (
                  <tr key={i} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3">
                      <Badge tone={t.direction === "LONG" ? "success" : "danger"}>{tDirection(t.direction)}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{t.entryPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.exitPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono text-muted">{t.stopLoss?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pr-3 font-mono text-muted">{t.takeProfit?.toFixed(2) ?? "—"}</td>
                    <td className={`py-1.5 pr-3 font-mono ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>{t.netPnl.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-muted">{tExitReason(t.exitReason)}</td>
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

