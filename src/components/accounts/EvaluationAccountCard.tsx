"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { StatTile } from "@/components/ui/StatTile";

interface EvaluationView {
  profileType: string;
  phase: "PHASE_1" | "PHASE_2";
  initialBalance: number;
  phase1TargetPct: number;
  phase2TargetPct: number;
  baseRiskPct: number;
  startedAt: string;
  targetReachedAt: string | null;
  daysToTarget: number | null;
  failureReason: string | null;
  failedAt: string | null;
  currentEquity: number;
  status: "ACTIVE" | "TARGET_REACHED" | "FAILED";
  totalPnlPct: number;
  dailyPnlPct: number | null;
  currentRiskPct: number;
  currentRiskReason: "BASE_RISK" | "TOTAL_DRAWDOWN_PROTECTION";
  blockNewEntries: boolean;
}

const STATUS_TONE: Record<EvaluationView["status"], BadgeTone> = { ACTIVE: "success", TARGET_REACHED: "info", FAILED: "danger" };

function pct(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * MT5 Fase 2, spec section 14 — Evaluation Account card. Read-only display
 * of the SAME evaluation the execution pipeline enforces (never a separate
 * "UI opinion") plus the one deliberate human action this UI offers:
 * starting/restarting an evaluation from a template, and advancing a
 * TARGET_REACHED PHASE_1 evaluation into PHASE_2 — both explicit, never
 * automatic.
 */
export function EvaluationAccountCard() {
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileType, setProfileType] = useState<"20K" | "50K" | "100K" | "CUSTOM">("20K");
  const [customBalance, setCustomBalance] = useState("10000");

  async function refresh() {
    const res = await fetch("/api/mt5/evaluation");
    const json = await res.json();
    if (json.ok) setEvaluation(json.evaluation);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { profileType };
      if (profileType === "CUSTOM") body.initialBalance = Number(customBalance);
      const res = await fetch("/api/mt5/evaluation", { method: "POST", body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "No se pudo iniciar la evaluación.");
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleAdvance() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mt5/evaluation/advance-phase2", { method: "POST" });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "No se pudo avanzar a PHASE_2.");
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  const targetPct = evaluation ? (evaluation.phase === "PHASE_1" ? evaluation.phase1TargetPct : evaluation.phase2TargetPct) : 0;
  const targetProgressPct = evaluation && targetPct > 0 ? Math.max(0, Math.min(100, (evaluation.totalPnlPct / targetPct) * 100)) : 0;

  return (
    <Card
      title="Evaluation Account"
      subtitle="Reglas estilo prop-firm sobre la cuenta MT5 Demo — nunca sobre la cuenta de paper trading"
      actions={evaluation ? <Badge tone={STATUS_TONE[evaluation.status]}>{evaluation.status}</Badge> : <Badge tone="muted">SIN CONFIGURAR</Badge>}
    >
      {!evaluation ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-300">No hay ninguna Evaluation Account activa. Elige un perfil para empezar.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={profileType}
              onChange={(e) => setProfileType(e.target.value as typeof profileType)}
              className="rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
            >
              <option value="20K">20K</option>
              <option value="50K">50K</option>
              <option value="100K">100K</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
            {profileType === "CUSTOM" && (
              <input
                type="number"
                min={1}
                value={customBalance}
                onChange={(e) => setCustomBalance(e.target.value)}
                placeholder="Balance inicial"
                className="w-32 rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
              />
            )}
            <button
              onClick={handleStart}
              disabled={loading}
              className="rounded border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              Iniciar evaluación
            </button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Profile" value={evaluation.profileType} />
            <StatTile label="Phase" value={evaluation.phase} />
            <StatTile label="Target" value={`+${targetPct}%`} />
            <StatTile label="Target Progress" value={`${targetProgressPct.toFixed(0)}%`} sublabel={pct(evaluation.totalPnlPct)} />
            <StatTile label="Daily DD" value={pct(evaluation.dailyPnlPct)} tone={evaluation.dailyPnlPct !== null && evaluation.dailyPnlPct < 0 ? "negative" : "neutral"} />
            <StatTile label="Total DD" value={pct(evaluation.totalPnlPct < 0 ? evaluation.totalPnlPct : null)} tone={evaluation.totalPnlPct < 0 ? "negative" : "neutral"} />
            <StatTile label="Base Risk" value={`${evaluation.baseRiskPct}%`} />
            <StatTile
              label="Current Risk"
              value={`${evaluation.currentRiskPct}%`}
              sublabel={evaluation.currentRiskReason === "TOTAL_DRAWDOWN_PROTECTION" ? "TOTAL DRAWDOWN PROTECTION" : "Base"}
              tone={evaluation.currentRiskReason === "TOTAL_DRAWDOWN_PROTECTION" ? "negative" : "neutral"}
            />
          </div>

          {evaluation.blockNewEntries && evaluation.status === "ACTIVE" && (
            <p className="text-xs font-semibold text-warn">Límite diario alcanzado — no se abrirán nuevas operaciones MT5 hasta el próximo reinicio de día.</p>
          )}
          {evaluation.status === "FAILED" && <p className="text-xs font-semibold text-danger">{evaluation.failureReason}</p>}
          {evaluation.status === "TARGET_REACHED" && (
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-info">
                Target alcanzado{evaluation.daysToTarget ? ` en ${evaluation.daysToTarget} día(s)` : ""}. No se abrirán nuevas operaciones.
              </p>
              {evaluation.phase === "PHASE_1" && (
                <button onClick={handleAdvance} disabled={loading} className="rounded border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">
                  Avanzar a PHASE_2
                </button>
              )}
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}

          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Reiniciar evaluación</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={profileType}
                onChange={(e) => setProfileType(e.target.value as typeof profileType)}
                className="rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
              >
                <option value="20K">20K</option>
                <option value="50K">50K</option>
                <option value="100K">100K</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
              {profileType === "CUSTOM" && (
                <input
                  type="number"
                  min={1}
                  value={customBalance}
                  onChange={(e) => setCustomBalance(e.target.value)}
                  className="w-32 rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
                />
              )}
              <button onClick={handleStart} disabled={loading} className="rounded border border-bg-border px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-50">
                Reiniciar
              </button>
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}
