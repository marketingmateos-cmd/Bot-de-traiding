"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { StatTile } from "@/components/ui/StatTile";

interface Mt5ConnectionView {
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  statusDetail?: string | null;
  broker?: string | null;
  server?: string | null;
  loginId: string | null;
  accountType?: string | null;
  verifiedDemo: boolean;
  balance?: number | null;
  equity?: number | null;
  margin?: number | null;
  freeMargin?: number | null;
  leverage?: number | null;
  currency?: string | null;
  latencyMs?: number | null;
  lastSyncAt?: string | null;
  lastErrorMessage?: string | null;
  executionEnabled: boolean;
}

const STATUS_TONE: Record<Mt5ConnectionView["status"], BadgeTone> = { CONNECTED: "success", DISCONNECTED: "muted", ERROR: "danger" };

function money(value: number | null | undefined, currency: string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
}

/**
 * MT5 Fase 1, spec section 4/21 — the ONLY UI surface for the MT5 demo
 * connection. Never renders a password field's value, never has a way to
 * display a stored password (there is none to display — see
 * mt5ConnectionStore.ts), and never offers an "Enable Live Trading"
 * control of any kind.
 */
export function Mt5AccountCard() {
  const [connection, setConnection] = useState<Mt5ConnectionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchReasons, setSwitchReasons] = useState<string[]>([]);
  const [form, setForm] = useState({ login: "", password: "", server: "" });

  async function refresh() {
    const res = await fetch("/api/mt5/status");
    const json = await res.json();
    if (json.ok) setConnection(json.connection);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mt5/connect", { method: "POST", body: JSON.stringify(form) });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "No se pudo conectar.");
      setConnection(json.connection);
      // Never keep the password in memory longer than the request needs it.
      setForm({ login: "", password: "", server: "" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      const res = await fetch("/api/mt5/disconnect", { method: "POST" });
      const json = await res.json();
      setConnection(json.connection);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleExecution(enabled: boolean) {
    setLoading(true);
    setSwitchReasons([]);
    try {
      const res = await fetch("/api/mt5/execution-switch", { method: "POST", body: JSON.stringify({ enabled }) });
      const json = await res.json();
      if (!json.ok) setSwitchReasons(json.reasons ?? [json.error]);
      if (json.connection) setConnection(json.connection);
    } finally {
      setLoading(false);
    }
  }

  const isConnected = connection?.status === "CONNECTED";

  return (
    <div className="flex flex-col gap-4">
      <Card title="MT5 Demo Account" className="border-accent/40 bg-accent/5" actions={<Badge tone="warn">DEMO ONLY</Badge>}>
        <p className="mb-3 text-xs text-slate-300">
          EdgeLab AI&apos;s MT5 integration is restricted to demo accounts in this version. No live account, no live execution, no bypass — a live
          account is detected and blocked automatically, never accepted.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Status" value={<Badge tone={connection ? STATUS_TONE[connection.status] : "muted"}>{connection?.status ?? "DISCONNECTED"}</Badge>} />
          <StatTile label="Account type" value={connection?.verifiedDemo ? "DEMO" : connection?.accountType ?? "—"} tone={connection?.verifiedDemo ? "positive" : "neutral"} />
          <StatTile label="Broker" value={connection?.broker ?? "—"} />
          <StatTile label="Server" value={connection?.server ?? "—"} />
          <StatTile label="Login" value={connection?.loginId ?? "—"} />
          <StatTile label="Balance" value={money(connection?.balance, connection?.currency)} />
          <StatTile label="Equity" value={money(connection?.equity, connection?.currency)} />
          <StatTile label="Free Margin" value={money(connection?.freeMargin, connection?.currency)} />
          <StatTile label="Leverage" value={connection?.leverage ? `1:${connection.leverage}` : "—"} />
          <StatTile label="Currency" value={connection?.currency ?? "—"} />
          <StatTile label="Latency" value={connection?.latencyMs !== null && connection?.latencyMs !== undefined ? `${connection.latencyMs} ms` : "—"} />
          <StatTile label="Última sincronización" value={connection?.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : "—"} />
        </div>

        {connection?.lastErrorMessage && <p className="mt-3 text-xs text-danger">{connection.lastErrorMessage}</p>}
        {connection && !connection.verifiedDemo && connection.status === "CONNECTED" && (
          <p className="mt-3 text-xs font-semibold text-danger">Live accounts are disabled. EdgeLab AI only supports MT5 demo accounts.</p>
        )}
      </Card>

      <Card title="Conexión">
        {!isConnected ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Login (número de cuenta MT5)"
              value={form.login}
              onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
              className="rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
            />
            <input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="off"
              className="rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
            />
            <input
              type="text"
              placeholder="Server (p. ej. BrokerName-Demo)"
              value={form.server}
              onChange={(e) => setForm((f) => ({ ...f, server: e.target.value }))}
              className="rounded border border-bg-border bg-black/20 px-2 py-1 text-sm text-slate-100"
            />
            <p className="text-[11px] text-muted">La contraseña nunca se guarda ni se muestra — se usa una sola vez para conectar.</p>
            <button
              onClick={handleConnect}
              disabled={loading || !form.login || !form.password || !form.server}
              className="mt-1 self-start rounded border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              Conectar
            </button>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        ) : (
          <button onClick={handleDisconnect} disabled={loading} className="self-start rounded border border-bg-border px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5">
            Desconectar
          </button>
        )}
      </Card>

      <Card title="MT5 Demo Execution" subtitle="Safety Switch — OFF por defecto">
        <div className="flex items-center gap-3">
          <Badge tone={connection?.executionEnabled ? "success" : "muted"}>{connection?.executionEnabled ? "ENABLED" : "DISABLED"}</Badge>
          <button
            onClick={() => handleToggleExecution(!connection?.executionEnabled)}
            disabled={loading}
            className="rounded border border-bg-border px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-50"
          >
            {connection?.executionEnabled ? "Desactivar" : "Intentar activar"}
          </button>
        </div>
        {switchReasons.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-danger">
            {switchReasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">
          No existe ningún botón &quot;Enable Live Trading&quot; ni parámetro para saltarse la verificación de cuenta demo. La activación requiere:
          conexión establecida, cuenta demo verificada, y ningún circuit breaker activo.
        </p>
      </Card>
    </div>
  );
}
