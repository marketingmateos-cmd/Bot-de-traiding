"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

interface BotConfigDTO {
  isActive: boolean;
  status: string;
  statusDetail: string | null;
  intervalSeconds: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "ACTIVO",
  PAUSED: "EN PAUSA",
  ANALYZING: "ANALIZANDO",
  WAITING: "ESPERANDO OPORTUNIDAD",
  BLOCKED: "BLOQUEADO",
  ERROR: "ERROR",
  DEGRADED: "DEGRADADO",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  PAUSED: "muted",
  ANALYZING: "info",
  WAITING: "neutral",
  BLOCKED: "danger",
  ERROR: "danger",
  DEGRADED: "warn",
};

function secondsAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

function secondsUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 1000);
}

export type WorkerHealth = "UNKNOWN" | "HEALTHY" | "STALLED";

/**
 * Fase 4 — "worker status" distinct from the bot's ACTIVE/PAUSED trading
 * intent: this reflects whether the persistent process's self-scheduling
 * loop (botLoop.ts) is actually still heartbeating, regardless of whether
 * the bot is currently set to trade. `lastRunAt` updates every single cycle
 * (see botLoop.ts's `finally` block) whether or not the bot is active or a
 * cycle found anything to do — so a `lastRunAt` far older than the
 * configured interval means the worker process itself has died or hung
 * (crashed, killed externally, stuck in a network call), independent of
 * whatever the last-known status/badge says. A generous 3x-interval-plus-30s
 * buffer avoids false alarms from one slow cycle.
 */
export function computeWorkerHealth(lastRunAt: string | null, intervalSeconds: number, now = Date.now()): WorkerHealth {
  if (!lastRunAt) return "UNKNOWN";
  const ageSeconds = (now - new Date(lastRunAt).getTime()) / 1000;
  const staleAfter = Math.max(30, intervalSeconds) * 3 + 30;
  return ageSeconds > staleAfter ? "STALLED" : "HEALTHY";
}

const WORKER_LABEL: Record<WorkerHealth, string> = {
  UNKNOWN: "SIN DATOS AÚN",
  HEALTHY: "EN LÍNEA",
  STALLED: "SIN RESPUESTA",
};

const WORKER_TONE: Record<WorkerHealth, BadgeTone> = {
  UNKNOWN: "muted",
  HEALTHY: "success",
  STALLED: "danger",
};

/**
 * Live bot status + on/off switch (spec §10/§11) — polls its own status
 * every few seconds and refreshes the server-rendered dashboard alongside
 * it, which is what makes P&L/positions update without a manual "scan"
 * button (spec §5): no websocket infrastructure, just a short poll that
 * re-fetches the same Prisma-backed data the page already renders with.
 */
export function BotStatusCard({ marketsMonitored }: { marketsMonitored: number }) {
  const router = useRouter();
  const [config, setConfig] = useState<BotConfigDTO | null>(null);
  const [toggling, setToggling] = useState(false);
  const [, forceTick] = useState(0);
  const lastRefreshedStatus = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/bot/status", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data.ok) {
          setConfig(data.config);
          // Refresh the server-rendered page data whenever the bot finishes
          // a cycle (status just changed), so equity/positions/P&L catch up
          // without the user doing anything.
          if (lastRefreshedStatus.current !== null && lastRefreshedStatus.current !== data.config.status) {
            router.refresh();
          }
          lastRefreshedStatus.current = data.config.status;
        }
      } catch {
        // transient network hiccup — next poll will retry
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [router]);

  // Re-render every second just for the "hace Ns" / "en Ns" countdown text.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function toggle() {
    if (!config) return;
    setToggling(true);
    try {
      const res = await fetch("/api/bot/toggle", { method: "POST", body: JSON.stringify({ isActive: !config.isActive }) });
      const data = await res.json();
      if (data.ok) setConfig(data.config);
      router.refresh();
    } finally {
      setToggling(false);
    }
  }

  const status = config?.status ?? "WAITING";
  const label = STATUS_LABEL[status] ?? status;
  const tone = STATUS_TONE[status] ?? "neutral";
  const lastAgo = secondsAgo(config?.lastRunAt ?? null);
  const nextIn = secondsUntil(config?.nextRunAt ?? null);
  // Fase 4: the worker (persistent process + self-scheduling loop) is a
  // distinct concept from the bot's ACTIVE/PAUSED trading intent — this
  // reflects whether botLoop.ts is still actually heartbeating at all,
  // which matters most precisely when the bot is ACTIVE and the app
  // window is closed (Electron keeps running in the tray — see
  // electron/main.js — so this should stay HEALTHY even then).
  const workerHealth = computeWorkerHealth(config?.lastRunAt ?? null, config?.intervalSeconds ?? 60);

  return (
    <div className="rounded-lg border border-bg-border bg-bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">BOT</span>
          <Badge tone={tone}>{label}</Badge>
          <span className="text-[11px] text-muted">·</span>
          <span className="text-[11px] text-muted">Worker:</span>
          <Badge tone={WORKER_TONE[workerHealth]}>{WORKER_LABEL[workerHealth]}</Badge>
        </div>
        <button
          onClick={toggle}
          disabled={!config || toggling}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
            config?.isActive ? "border-accent/40 bg-accent/10 text-accent" : "border-bg-border text-muted hover:text-slate-200"
          }`}
        >
          {config?.isActive ? "ON — apagar" : "OFF — encender"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        {config?.statusDetail ?? "Vigilando mercados en paper trading."} · Mercados vigilados: {marketsMonitored}
      </p>
      <p className="mt-1 text-[11px] text-muted">
        {lastAgo !== null ? `Último análisis: hace ${lastAgo}s` : "Aún no ha corrido ningún ciclo"}
        {config?.isActive && nextIn !== null && nextIn > 0 ? ` · Próximo escaneo en ${nextIn}s` : ""}
      </p>
      {workerHealth === "STALLED" && (
        <p className="mt-1 text-[11px] text-danger">
          El proceso en segundo plano no ha respondido en el intervalo esperado — puede haberse detenido. Cierra y vuelve a abrir la aplicación si esto persiste.
        </p>
      )}
    </div>
  );
}
