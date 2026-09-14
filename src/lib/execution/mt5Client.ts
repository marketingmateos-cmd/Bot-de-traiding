import type { Mt5AccountInfo, Mt5Credentials, Mt5Position, Mt5Quote, Mt5SymbolSpec, PlaceOrderRequest, PlaceOrderResult } from "./types";

/**
 * MT5 Fase 1 — the LOW-LEVEL bridge to an actual MetaTrader 5 terminal.
 *
 * MetaTrader 5 has no public REST API like Binance: its official API (the
 * `MetaTrader5` Python package, or any ZeroMQ/DLL Expert Advisor bridge)
 * only works when talking to a real MT5 terminal process running on the
 * SAME machine (Windows, or Wine). This sandboxed development/CI
 * environment cannot run a real MT5 terminal, so this interface exists
 * specifically to make that boundary explicit and injectable — exactly the
 * same `fetchImpl`-style dependency-injection pattern used for the Binance
 * importer's `FetchLike` (see src/lib/marketData/binanceClient.ts): every
 * test in this module injects a fake `Mt5ClientLike`, and
 * `MT5DemoExecutionAdapter` never assumes one particular implementation.
 *
 * `createUnavailableMt5Client()` below is what actually gets wired up by
 * default in this environment — it always reports "not connected" rather
 * than silently pretending a connection exists. A real deployment (a
 * Windows machine, or a small companion process talking to a local MT5
 * terminal) would supply its own `Mt5ClientLike` implementation — e.g. a
 * thin wrapper around a Python `MetaTrader5`-backed sidecar process,
 * spawned the same way `electron/migrate.js` already spawns a Node child
 * process — without touching anything in this file or its callers.
 */
export interface Mt5ClientLike {
  /** Returns null if the login/password/server combination is rejected by the terminal — never throws for a bad login, only for a genuine transport failure. */
  login(credentials: Mt5Credentials): Promise<{ ok: boolean; error: string | null }>;
  logout(): Promise<void>;
  isConnected(): Promise<boolean>;
  accountInfo(): Promise<Mt5AccountInfo | null>;
  symbols(): Promise<string[]>;
  symbolInfo(symbol: string): Promise<Mt5SymbolSpec | null>;
  quote(symbol: string): Promise<Mt5Quote | null>;
  positions(): Promise<Mt5Position[]>;
  orderSend(request: PlaceOrderRequest): Promise<PlaceOrderResult>;
}

const NOT_AVAILABLE_REASON =
  "MetaTrader 5 no está disponible en este entorno: MT5 no tiene API REST pública, solo funciona contra un terminal MT5 real corriendo en la misma máquina (Windows/Wine). Este proceso no tiene ningún terminal MT5 real conectado.";

/**
 * The honest, always-safe default: reports itself as never connected,
 * rejects every operation with an explicit, non-misleading reason, and
 * never fabricates account/market data. Wiring a real backend means
 * supplying a different `Mt5ClientLike` at the call site — this function
 * is intentionally the only implementation shipped in this repository.
 */
export function createUnavailableMt5Client(): Mt5ClientLike {
  return {
    async login() {
      return { ok: false, error: NOT_AVAILABLE_REASON };
    },
    async logout() {},
    async isConnected() {
      return false;
    },
    async accountInfo() {
      return null;
    },
    async symbols() {
      return [];
    },
    async symbolInfo() {
      return null;
    },
    async quote() {
      return null;
    },
    async positions() {
      return [];
    },
    async orderSend() {
      return { status: "ERROR", ticket: null, filledPrice: null, executionLatencyMs: 0, rejectionReason: NOT_AVAILABLE_REASON };
    },
  };
}
