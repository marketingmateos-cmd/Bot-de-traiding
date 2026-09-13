"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProfitProtectionConfigFields {
  isEnabled: boolean;
  profitProtectionTriggerPct: number;
  hardStopLossPct: number;
  exceptionalMinConfidence: number;
  exceptionalMinEvidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  exceptionalSizeMultiplier: number;
}

// Fase 6 — "Daily Profit Protection" configuration must be persistent and
// editable, never hardcoded — this is the only place these numbers change.
// Every field here is a plain number/threshold, never an AI-judgment knob:
// there is deliberately no "let the AI decide" toggle, since the whole
// point of this feature is that the exception is quantitatively verifiable
// (see dailyProfitProtection.ts's checkExceptionalOpportunity).
export function ProfitProtectionForm({ current }: { current: ProfitProtectionConfigFields }) {
  const router = useRouter();
  const [form, setForm] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/profit-protection", { method: "POST", body: JSON.stringify(form) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "No se pudo guardar la configuración.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-100">
        <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} className="accent-accent" />
        Daily Profit Protection activada
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-300">Umbral de protección de beneficios (%)</div>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={form.profitProtectionTriggerPct}
            onChange={(e) => setForm({ ...form, profitProtectionTriggerPct: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm font-mono text-slate-100"
          />
          <p className="mt-1 text-[11px] text-muted">P&L del día (%) a partir del cual solo se permiten oportunidades excepcionales.</p>
        </div>
        <div>
          <div className="text-xs text-slate-300">Límite de parada dura diaria (%)</div>
          <input
            type="number"
            step="0.1"
            max="-0.1"
            value={form.hardStopLossPct}
            onChange={(e) => setForm({ ...form, hardStopLossPct: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm font-mono text-slate-100"
          />
          <p className="mt-1 text-[11px] text-muted">P&L del día (negativo) a partir del cual se bloquean TODAS las operaciones nuevas, sin excepción.</p>
        </div>
        <div>
          <div className="text-xs text-slate-300">Confianza mínima de la IA Analista para excepción</div>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={form.exceptionalMinConfidence}
            onChange={(e) => setForm({ ...form, exceptionalMinConfidence: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm font-mono text-slate-100"
          />
          <p className="mt-1 text-[11px] text-muted">De 0 a 1. Una de varias condiciones — nunca suficiente por sí sola.</p>
        </div>
        <div>
          <div className="text-xs text-slate-300">Evidencia histórica mínima para excepción</div>
          <select
            value={form.exceptionalMinEvidenceLevel}
            onChange={(e) => setForm({ ...form, exceptionalMinEvidenceLevel: e.target.value as "LOW" | "MEDIUM" | "HIGH" })}
            className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
          >
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
          <p className="mt-1 text-[11px] text-muted">Nivel de Luck vs Edge exigido — sin historial real y verificable no hay excepción posible.</p>
        </div>
        <div>
          <div className="text-xs text-slate-300">Tamaño de la excepción (multiplicador)</div>
          <input
            type="number"
            step="0.05"
            min="0.05"
            max="1"
            value={form.exceptionalSizeMultiplier}
            onChange={(e) => setForm({ ...form, exceptionalSizeMultiplier: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-bg-border bg-black/20 px-2 py-1 text-sm font-mono text-slate-100"
          />
          <p className="mt-1 text-[11px] text-muted">Fracción del tamaño normal (ej. 0.5 = mitad) para una operación excepcional en PROFIT_PROTECTION.</p>
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="w-fit rounded border border-bg-border px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Guardar"}
      </button>
    </div>
  );
}
