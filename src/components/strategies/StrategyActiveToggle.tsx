"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";

/**
 * MVP Bloque 2 — control de qué estrategias usa el bot en su próximo
 * ciclo (`runPaperTradingScan()` ya filtra por `strategy.isActive`, este
 * componente es la primera UI que escribe ese campo). Cambia el estado de
 * la ESTRATEGIA (`Strategy.isActive`), no de esta versión en particular —
 * si una estrategia tiene varias versiones, todas comparten el mismo
 * interruptor porque comparten el mismo `Strategy.id`.
 */
export function StrategyActiveToggle({ strategyId, initialIsActive }: { strategyId: string; initialIsActive: boolean }) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(initialIsActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    const next = !isActive;
    try {
      const res = await fetch(`/api/strategies/${strategyId}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "No se pudo actualizar la estrategia.");
        return;
      }
      setIsActive(data.strategy.isActive);
      router.refresh();
    } catch {
      setError("Fallo de red al actualizar la estrategia.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Badge tone={isActive ? "success" : "muted"}>{isActive ? "ACTIVA PARA EL BOT" : "INACTIVA"}</Badge>
      <button
        onClick={toggle}
        disabled={pending}
        className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
          isActive ? "border-accent/40 bg-accent/10 text-accent" : "border-bg-border text-muted hover:text-slate-200"
        }`}
      >
        {isActive ? "Desactivar para el bot" : "Activar para el bot"}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
