"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { StatTile } from "@/components/ui/StatTile";
import { EquityCurveChart } from "@/components/charts/EquityCurveChart";
import { tDirection, tExitReason } from "@/lib/i18n";
import type {
  ReplayAiMode,
  ReplayDataSource,
  ReplaySegmentResult,
  ReplayDataQualityReport,
  EvidenceQualityReport,
} from "@/lib/replay/types";
import type { OverfittingReport } from "@/lib/engines/overfitting";
import type { WalkForwardResult } from "@/lib/engines/walkForward";
import type { RobustnessClassification } from "@/lib/replay/replayRobustness";
import type { TimeframeCode } from "@/lib/providers/types";

interface RunDetail {
  id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
  dataQualityReport: ReplayDataQualityReport | null;
  walkForward: WalkForwardResult | null;
  robustness: { score: number; classification: RobustnessClassification; factors: { name: string; score: number; detail: string }[] } | null;
  overfitting: OverfittingReport | null;
  evidence: EvidenceQualityReport | null;
  results: ReplaySegmentResult[];
}

const EVIDENCE_TONE: Record<EvidenceQualityReport["verdict"], BadgeTone> = {
  INSUFFICIENT_EVIDENCE: "muted",
  LOW: "danger",
  MEDIUM: "warn",
  HIGH: "success",
};

const ROBUSTNESS_TONE: Record<RobustnessClassification, BadgeTone> = {
  ROBUST: "success",
  MODERATE: "warn",
  FRAGILE: "danger",
  INSUFFICIENT_DATA: "muted",
};

export function HistoricalReplayForm({ assetSymbols, strategies }: { assetSymbols: string[]; strategies: { id: string; name: string }[] }) {
  const [selectedAssets, setSelectedAssets] = useState<string[]>(assetSymbols.slice(0, 1));
  const [timeframe, setTimeframe] = useState<TimeframeCode>("H1");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-04-01");
  const [strategyId, setStrategyId] = useState<string | "ALL">("ALL");
  const [aiMode, setAiMode] = useState<ReplayAiMode>("DETERMINISTIC_AI");
  const [dataSource, setDataSource] = useState<ReplayDataSource>("SYNTHETIC");
  const [initialCapital, setInitialCapital] = useState(10000);
  const [riskLevel, setRiskLevel] = useState(6);
  const [useSegments, setUseSegments] = useState(false);
  const [useWalkForward, setUseWalkForward] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);

  function toggleAsset(symbol: string) {
    setSelectedAssets((prev) => (prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]));
  }

  async function runReplay() {
    setRunning(true);
    setError(null);
    setRun(null);
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const totalDays = (end.getTime() - start.getTime()) / (24 * 60 * 60_000);

      const body: Record<string, unknown> = {
        assetSymbols: selectedAssets,
        timeframe,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        strategyId: strategyId === "ALL" ? null : strategyId,
        aiMode,
        dataSource,
        initialCapital,
        riskLevel,
      };

      if (useSegments && totalDays >= 30) {
        const isEnd = new Date(start.getTime() + totalDays * 0.6 * 24 * 60 * 60_000);
        const validationEnd = new Date(start.getTime() + totalDays * 0.8 * 24 * 60 * 60_000);
        body.segments = {
          is: { start: start.toISOString(), end: isEnd.toISOString() },
          validation: { start: new Date(isEnd.getTime() + 3600_000).toISOString(), end: validationEnd.toISOString() },
          oos: { start: new Date(validationEnd.getTime() + 3600_000).toISOString(), end: end.toISOString() },
        };
      }
      if (useWalkForward) {
        body.walkForward = { windowSizeDays: Math.max(14, Math.floor(totalDays / 3)), trainFraction: 0.7, stepDays: Math.max(14, Math.floor(totalDays / 3)) };
      }

      const runRes = await fetch("/api/replay/run", { method: "POST", body: JSON.stringify(body) });
      const runJson = await runRes.json();
      if (!runJson.ok) {
        setError(runJson.error ?? "No se pudo ejecutar el replay.");
        return;
      }

      const detailRes = await fetch(`/api/replay/${runJson.runId}`);
      const detailJson = await detailRes.json();
      if (!detailJson.ok) {
        setError("No se pudo cargar el resultado del replay.");
        return;
      }
      setRun(detailJson.run as RunDetail);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card title="Configuración">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs text-slate-300">Activos</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {assetSymbols.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => toggleAsset(symbol)}
                  className={`rounded border px-2 py-1 text-xs ${selectedAssets.includes(symbol) ? "border-accent bg-accent/10 text-accent" : "border-bg-border text-slate-300 hover:bg-white/5"}`}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-300">Estrategia</div>
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100">
              <option value="ALL">Bot completo (todas las estrategias)</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-300">Timeframe</div>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as TimeframeCode)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100">
              {(["M15", "H1", "H4", "D1"] as TimeframeCode[]).map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-slate-300">Fecha inicio</div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100" />
            </div>
            <div>
              <div className="text-xs text-slate-300">Fecha fin</div>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100" />
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-300">Modo de IA</div>
            <select value={aiMode} onChange={(e) => setAiMode(e.target.value as ReplayAiMode)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100">
              <option value="FULL_HISTORICAL">FULL HISTORICAL (solo datos reales ya registrados)</option>
              <option value="DETERMINISTIC_AI">DETERMINISTIC AI (reglas, reproducible)</option>
              <option value="AI_ASSISTED">AI ASSISTED (IA en vivo, experimental)</option>
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-300">Fuente de datos</div>
            <select value={dataSource} onChange={(e) => setDataSource(e.target.value as ReplayDataSource)} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100">
              <option value="SYNTHETIC">SYNTHETIC (demo, para probar la infraestructura)</option>
              <option value="HISTORICAL_REAL">HISTORICAL_REAL (no disponible en este entorno)</option>
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-300">Capital inicial</div>
            <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm font-mono text-slate-100" />
          </div>

          <div>
            <div className="text-xs text-slate-300">Risk Level: {riskLevel}/10</div>
            <input type="range" min={1} max={10} value={riskLevel} onChange={(e) => setRiskLevel(Number(e.target.value))} className="mt-2 w-full accent-accent" />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-bg-border pt-3 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useSegments} onChange={(e) => setUseSegments(e.target.checked)} className="accent-accent" />
            Separar en IN-SAMPLE / VALIDATION / OUT-OF-SAMPLE (60% / 20% / 20% del rango, requiere 30+ días)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useWalkForward} onChange={(e) => setUseWalkForward(e.target.checked)} className="accent-accent" />
            Ejecutar Walk-Forward (ventanas deslizantes sobre el mismo rango)
          </label>
        </div>

        <button
          onClick={runReplay}
          disabled={running || selectedAssets.length === 0}
          className="mt-4 rounded border border-accent bg-accent/10 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {running ? "EJECUTANDO REPLAY... (puede tardar unos segundos)" : "RUN REPLAY"}
        </button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      {run && <ReplayResults run={run} />}
    </div>
  );
}

function ReplayResults({ run }: { run: RunDetail }) {
  if (run.status === "FAILED") {
    return (
      <Card title="Replay fallido" className="border-danger/40 bg-danger/5">
        <p className="text-sm text-danger">{run.error}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {run.dataQualityReport && <DataQualityCard report={run.dataQualityReport} />}

      {run.results.map((segment) => (
        <SegmentCard key={segment.label} segment={segment} />
      ))}

      {run.walkForward && <WalkForwardCard walkForward={run.walkForward} />}
      {run.robustness && <RobustnessCard robustness={run.robustness} />}
      {run.overfitting && <OverfittingCard overfitting={run.overfitting} />}
      {run.evidence && <EvidenceCard evidence={run.evidence} />}
    </div>
  );
}

function DataQualityCard({ report }: { report: ReplayDataQualityReport }) {
  return (
    <Card title="Data Quality Report" subtitle="Evaluado antes de ejecutar el replay (Fase 7C)">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <StatTile label="Cobertura" value={`${report.coveragePct.toFixed(1)}%`} tone={report.coveragePct >= 90 ? "positive" : report.coveragePct >= 50 ? "neutral" : "negative"} />
        <StatTile label="Velas faltantes" value={`${report.missingCandlesPct.toFixed(1)}%`} />
        <StatTile label="Timestamps duplicados" value={report.duplicateTimestamps} tone={report.duplicateTimestamps > 0 ? "negative" : "positive"} />
        <StatTile label="Velas inválidas" value={report.invalidCandles} tone={report.invalidCandles > 0 ? "negative" : "positive"} />
        <StatTile label="Fuga de datos futuros" value={report.futureLeakage} tone={report.futureLeakage > 0 ? "negative" : "positive"} />
        <StatTile label="Violaciones de orden" value={report.chronologyViolations} tone={report.chronologyViolations > 0 ? "negative" : "positive"} />
      </div>
      {report.warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-xs text-warn">
          {report.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SegmentCard({ segment }: { segment: ReplaySegmentResult }) {
  const m = segment.metrics;
  return (
    <Card
      title={`Resultados — ${segment.label}`}
      subtitle={`${new Date(segment.startDate).toLocaleDateString()} → ${new Date(segment.endDate).toLocaleDateString()}`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <StatTile label="Retorno Total" value={`${m.totalReturnPct >= 0 ? "+" : ""}${m.totalReturnPct.toFixed(2)}%`} tone={m.totalReturnPct >= 0 ? "positive" : "negative"} />
        <StatTile label="Equity Final" value={m.finalEquity.toFixed(2)} />
        <StatTile label="Operaciones" value={m.trades} />
        <StatTile label="Win Rate" value={`${(m.winRate * 100).toFixed(0)}%`} />
        <StatTile label="Max Drawdown" value={`${m.maxDrawdownPct.toFixed(1)}%`} tone={m.maxDrawdownPct > 20 ? "negative" : "neutral"} />
        <StatTile label="Exposición" value={`${m.exposurePct.toFixed(0)}%`} />
        <StatTile label="Expectancy" value={m.expectancy.toFixed(2)} tone={m.expectancy >= 0 ? "positive" : "negative"} />
        <StatTile label="Profit Factor" value={m.profitFactor === null ? "—" : m.profitFactor.toFixed(2)} />
        <StatTile label="Sharpe" value={m.sharpe === null ? "—" : m.sharpe.toFixed(2)} />
        <StatTile label="Sortino" value={m.sortino === null ? "—" : m.sortino.toFixed(2)} />
        <StatTile label="Racha Ganadora" value={m.longestWinStreak} />
        <StatTile label="Racha Perdedora" value={m.longestLossStreak} />
      </div>

      {segment.equityCurve.length > 1 && (
        <div className="mt-4">
          <EquityCurveChart data={segment.equityCurve} />
        </div>
      )}

      {segment.trades.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-200">Operaciones ({segment.trades.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Activo</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entrada</th>
                  <th className="py-1 pr-3">Salida</th>
                  <th className="py-1 pr-3">P&L Neto</th>
                  <th className="py-1 pr-3">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {segment.trades.map((t, i) => (
                  <tr key={i} className="border-t border-bg-border">
                    <td className="py-1.5 pr-3 font-medium">{t.asset}</td>
                    <td className="py-1.5 pr-3">{tDirection(t.direction)}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.entryPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.exitPrice.toFixed(2)}</td>
                    <td className={`py-1.5 pr-3 font-mono ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>{t.netPnl.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-muted">{tExitReason(t.exitReason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {segment.decisions.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-200">Timeline de decisiones — ¿por qué entró el bot? ({segment.decisions.length})</summary>
          <div className="mt-2 flex flex-col gap-2">
            {segment.decisions.map((d, i) => (
              <details key={i} className="rounded border border-bg-border bg-black/20 p-2 text-xs">
                <summary className="cursor-pointer">
                  <span className="font-mono text-muted">{new Date(d.timestamp).toLocaleString()}</span> · <span className="font-medium">{d.asset}</span> ·{" "}
                  <Badge tone={d.decision === "OPENED" ? "success" : d.decision === "REDUCED_SIZE" ? "warn" : "danger"}>{d.decision}</Badge>
                </summary>
                <div className="mt-2 flex flex-col gap-1 text-[11px] text-slate-300">
                  <div>
                    <span className="text-muted">Market:</span> régimen {d.regime ?? "—"}, datos de mercado {d.availability.marketData}
                  </div>
                  <div>
                    <span className="text-muted">Strategy:</span> {d.strategyName} → {d.signal ? `${d.signal.direction} (${d.signal.reason})` : "sin señal"}
                  </div>
                  <div>
                    <span className="text-muted">Intelligence:</span> news {d.availability.news}, sentiment {d.availability.sentiment}, on-chain {d.availability.onChain}
                  </div>
                  <div>
                    <span className="text-muted">AI Analyst:</span>{" "}
                    {d.aiAnalyst ? `${d.aiAnalyst.recommendation} (confianza ${(d.aiAnalyst.confidence * 100).toFixed(0)}%)` : `no disponible (${d.availability.ai})`}
                  </div>
                  <div>
                    <span className="text-muted">AI Critic:</span> {d.aiCritic ? d.aiCritic.verdict : "no disponible"}
                  </div>
                  <div>
                    <span className="text-muted">Trade Gate:</span> {d.tradeGateVerdict ?? "—"} {d.tradeGateBlockedBy ? `(bloqueado por ${d.tradeGateBlockedBy})` : ""}
                  </div>
                  <div>
                    <span className="text-muted">Risk:</span> {d.riskPassed === null ? "—" : d.riskPassed ? "OK" : d.riskViolations?.join("; ")}
                  </div>
                  <div>
                    <span className="text-muted">Execution:</span>{" "}
                    {d.positionSize ? `tamaño ${d.positionSize.toFixed(4)} @ ${d.entryPrice?.toFixed(2)}` : "sin ejecución"}
                  </div>
                  <div className="text-muted">{d.reason}</div>
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

function WalkForwardCard({ walkForward }: { walkForward: WalkForwardResult }) {
  return (
    <Card title="Walk-Forward" subtitle={`${walkForward.windows.length} ventana(s)`}>
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Retorno OOS Medio" value={`${walkForward.aggregateOosMetrics.avgReturnPct.toFixed(2)}%`} tone={walkForward.aggregateOosMetrics.avgReturnPct >= 0 ? "positive" : "negative"} />
        <StatTile label="Sharpe OOS Medio" value={walkForward.aggregateOosMetrics.avgSharpe === null ? "—" : walkForward.aggregateOosMetrics.avgSharpe.toFixed(2)} />
        <StatTile label="% Ventanas Rentables" value={`${(walkForward.aggregateOosMetrics.winRateOfWindows * 100).toFixed(0)}%`} />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3">Ventana</th>
              <th className="py-1 pr-3">Train</th>
              <th className="py-1 pr-3">Test (OOS)</th>
              <th className="py-1 pr-3">Retorno Train</th>
              <th className="py-1 pr-3">Retorno OOS</th>
              <th className="py-1 pr-3">Degradado</th>
            </tr>
          </thead>
          <tbody>
            {walkForward.windows.map((w) => (
              <tr key={w.windowIndex} className="border-t border-bg-border">
                <td className="py-1.5 pr-3">#{w.windowIndex}</td>
                <td className="py-1.5 pr-3 text-muted">{new Date(w.trainRange[0]).toLocaleDateString()}</td>
                <td className="py-1.5 pr-3 text-muted">{new Date(w.oosRange[0]).toLocaleDateString()}</td>
                <td className="py-1.5 pr-3 font-mono">{w.trainMetrics.totalReturnPct.toFixed(1)}%</td>
                <td className="py-1.5 pr-3 font-mono">{w.oosMetrics.totalReturnPct.toFixed(1)}%</td>
                <td className="py-1.5 pr-3">{w.degraded ? <Badge tone="danger">SÍ</Badge> : <Badge tone="success">no</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RobustnessCard({ robustness }: { robustness: { score: number; classification: RobustnessClassification; factors: { name: string; score: number; detail: string }[] } }) {
  return (
    <Card title="Robustez" subtitle={`Puntuación: ${robustness.score}/100`}>
      <Badge tone={ROBUSTNESS_TONE[robustness.classification]}>{robustness.classification}</Badge>
      <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-300">
        {robustness.factors.map((f) => (
          <li key={f.name}>
            <span className="font-medium text-slate-100">{f.name}</span> ({f.score.toFixed(0)}/100): {f.detail}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OverfittingCard({ overfitting }: { overfitting: OverfittingReport }) {
  return (
    <Card title="Overfitting" subtitle={`Riesgo: ${overfitting.risk} (${overfitting.score}/100)`}>
      <Badge tone={overfitting.risk === "HIGH" ? "danger" : overfitting.risk === "MEDIUM" ? "warn" : "success"}>{overfitting.risk}</Badge>
      {overfitting.flags.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-300">
          {overfitting.flags.map((f, i) => (
            <li key={i}>⚠ {f}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EvidenceCard({ evidence }: { evidence: EvidenceQualityReport }) {
  return (
    <Card title="EVIDENCE QUALITY" subtitle="No depende únicamente de la rentabilidad">
      <Badge tone={EVIDENCE_TONE[evidence.verdict]}>{evidence.verdict}</Badge>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Tamaño de Muestra" value={evidence.sampleSize} />
        <StatTile label="Cobertura Histórica" value={`${evidence.historicalCoveragePct.toFixed(1)}%`} />
        <StatTile label="Disponibilidad de IA" value={`${evidence.aiAvailabilityPct.toFixed(0)}%`} />
        <StatTile label="Calidad OOS" value={evidence.oosQualityScore === null ? "N/A" : `${evidence.oosQualityScore.toFixed(0)}/100`} />
        <StatTile label="Robustez" value={evidence.robustnessScore === null ? "N/A" : `${evidence.robustnessScore}/100`} />
        <StatTile label="Riesgo de Overfitting" value={evidence.overfittingRisk ?? "N/A"} />
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-300">
        {evidence.factors.map((f, i) => (
          <li key={i}>• {f}</li>
        ))}
      </ul>
    </Card>
  );
}
