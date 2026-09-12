"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveRiskLimitsForLevel, riskPresetForLevel } from "@/lib/engines/riskEngine";
import { tRiskProfile } from "@/lib/i18n";

// Spec: "Bot Risk" slider (1-10) — a decorative label was replaced with a
// dial that visibly changes real position-sizing/exposure limits as you
// drag it, saved on release so it doesn't spam the API on every pixel.
export function RiskLevelSlider({ accountId, current }: { accountId: string; current: number }) {
  const router = useRouter();
  const [level, setLevel] = useState(current);
  const [saving, setSaving] = useState(false);
  const limits = resolveRiskLimitsForLevel(level);

  async function commit(next: number) {
    setSaving(true);
    try {
      await fetch("/api/settings/risk-profile", { method: "POST", body: JSON.stringify({ accountId, riskLevel: next }) });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-100">Risk Level: {level}/10</span>
        <span className="rounded-full border border-bg-border px-2 py-0.5 text-[11px] text-muted">{tRiskProfile(riskPresetForLevel(level))}</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={level}
        disabled={saving}
        onChange={(e) => setLevel(Number(e.target.value))}
        onMouseUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => commit(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-accent"
      />
      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted sm:grid-cols-4">
        <div>
          <div className="text-slate-300">Riesgo por operación</div>
          <div className="font-mono text-slate-100">{limits.riskPerTradePct}%</div>
        </div>
        <div>
          <div className="text-slate-300">Exposición máxima</div>
          <div className="font-mono text-slate-100">{limits.maxExposurePct}%</div>
        </div>
        <div>
          <div className="text-slate-300">Máx. posiciones abiertas</div>
          <div className="font-mono text-slate-100">{limits.maxOpenPositions}</div>
        </div>
        <div>
          <div className="text-slate-300">Límite pérdida diaria</div>
          <div className="font-mono text-slate-100">{limits.maxDailyLossPct}%</div>
        </div>
      </div>
      <p className="text-[11px] text-muted">
        Afecta solo a las próximas operaciones — las posiciones ya abiertas mantienen su tamaño original.
      </p>
    </div>
  );
}
