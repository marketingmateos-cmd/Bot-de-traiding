import type { Mt5ClientLike } from "./mt5Client";
import { redactSecret } from "./secretRedaction";
import type { Mt5AccountInfo, Mt5Credentials, Mt5HistoricalBar, Mt5HistoricalTimeframe, Mt5Position, Mt5Quote, Mt5SymbolSpec, PlaceOrderRequest, PlaceOrderResult } from "./types";

/**
 * MT5 REAL BRIDGE — the ONE real `Mt5ClientLike` implementation this repo
 * ships, talking to `python/mt5_sidecar.py` (a separate OS process, started
 * on a Windows machine with a real MT5 DEMO terminal, running a stdlib-only
 * HTTP server on 127.0.0.1) over plain HTTP. `registry.ts` decides WHETHER
 * to wire this in — this module has no opinion on when it's used, exactly
 * the same separation `createUnavailableMt5Client()` already established.
 *
 * DEPENDENCY INJECTION: same `fetchImpl`-style pattern `mt5Client.ts`'s own
 * doc comment names as the precedent (`FetchLike` in
 * src/lib/marketData/binanceClient.ts) — every test injects a fake `fetch`,
 * never hits a real network or a real sidecar process.
 *
 * READ-ONLY BY CONSTRUCTION, not just convention: `orderSend()` below never
 * issues an HTTP request — there is no `/mt5/order*` route on the sidecar
 * for it to call in the first place (see mt5_sidecar.py's own docstring).
 * Even a bug in this file's `orderSend()` could not reach a real order,
 * because the far end simply has no endpoint that would place one.
 */

export type FetchLike = typeof fetch;

export interface Mt5SidecarClientOptions {
  /** e.g. "http://127.0.0.1:47822" — no trailing slash. Never defaults to anything reachable outside localhost. */
  baseUrl: string;
  /** The shared secret both this client and the sidecar process were started with (`MT5_SIDECAR_TOKEN`). Sent as `X-MT5-Sidecar-Token` on every request, never logged. */
  token: string;
  fetchImpl?: FetchLike;
  /** Per-request timeout — a hung sidecar process must never hang the caller forever. Default 10s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

class Mt5SidecarTransportError extends Error {}

export function createMt5SidecarClient(options: Mt5SidecarClientOptions): Mt5ClientLike {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          "X-MT5-Sidecar-Token": options.token,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Mt5SidecarTransportError(`El sidecar MT5 devolvió una respuesta no-JSON (status ${response.status}).`);
        }
      }
      if (!response.ok) {
        const message = (parsed as { error?: string } | null)?.error ?? `El sidecar MT5 respondió con status ${response.status}.`;
        throw new Mt5SidecarTransportError(message);
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof Mt5SidecarTransportError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Mt5SidecarTransportError(`No se pudo contactar con el sidecar MT5 en ${baseUrl}: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async login(credentials: Mt5Credentials) {
      try {
        const result = await request<{ ok: boolean; error: string | null }>("POST", "/mt5/login", credentials);
        // Defense in depth, mirroring mt5DemoExecutionAdapter.connect()'s
        // own redaction step — the sidecar's own error messages never
        // include the password, but this never trusts that alone.
        const error = result.error ? redactSecret(result.error, credentials.password) : null;
        return { ok: result.ok, error };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Fallo de transporte hacia el sidecar MT5.";
        return { ok: false, error: redactSecret(message, credentials.password) };
      }
    },

    async logout() {
      try {
        await request<Record<string, never>>("POST", "/mt5/logout");
      } catch {
        // Best-effort — a transport failure on logout must never throw and
        // block the caller from tearing down its own local state.
      }
    },

    async isConnected() {
      try {
        const result = await request<{ connected: boolean }>("GET", "/mt5/status");
        return result.connected;
      } catch {
        return false;
      }
    },

    async accountInfo(): Promise<Mt5AccountInfo | null> {
      try {
        const result = await request<{ account: Mt5AccountInfo | null }>("GET", "/mt5/account");
        return result.account;
      } catch {
        return null;
      }
    },

    async symbols(): Promise<string[]> {
      try {
        const result = await request<{ symbols: string[] }>("GET", "/mt5/symbols");
        return result.symbols;
      } catch {
        return [];
      }
    },

    async symbolInfo(symbol: string): Promise<Mt5SymbolSpec | null> {
      try {
        const result = await request<{ spec: Mt5SymbolSpec | null }>("GET", `/mt5/symbol?symbol=${encodeURIComponent(symbol)}`);
        return result.spec;
      } catch {
        return null;
      }
    },

    async quote(symbol: string): Promise<Mt5Quote | null> {
      try {
        const result = await request<{ quote: (Omit<Mt5Quote, "timestamp"> & { timestamp: string }) | null }>("GET", `/mt5/quote?symbol=${encodeURIComponent(symbol)}`);
        if (!result.quote) return null;
        return { ...result.quote, timestamp: new Date(result.quote.timestamp) };
      } catch {
        return null;
      }
    },

    async positions(): Promise<Mt5Position[]> {
      // Out of scope for this read-only bridge's first cut (open-position
      // reading was never requested for Block 1 — see the sidecar's own
      // route list) — safe empty default, same convention as
      // createUnavailableMt5Client() for anything unimplemented, never
      // fabricated data.
      return [];
    },

    async historicalRates(symbol: string, timeframe: Mt5HistoricalTimeframe, start: Date, end: Date): Promise<Mt5HistoricalBar[]> {
      try {
        const params = new URLSearchParams({ symbol, timeframe, start: start.toISOString(), end: end.toISOString() });
        const result = await request<{ bars: (Omit<Mt5HistoricalBar, "timestamp"> & { timestamp: string })[] }>("GET", `/mt5/historical?${params.toString()}`);
        return result.bars.map((b) => ({ ...b, timestamp: new Date(b.timestamp) }));
      } catch {
        return [];
      }
    },

    async orderSend(_request: PlaceOrderRequest): Promise<PlaceOrderResult> {
      // NEVER issues an HTTP request — see this file's own module doc
      // comment. The sidecar has no order-placing route to call.
      return {
        status: "ERROR",
        ticket: null,
        filledPrice: null,
        executionLatencyMs: 0,
        rejectionReason: "El puente MT5 real es de solo lectura por diseño — el envío de órdenes no está implementado.",
      };
    },
  };
}
