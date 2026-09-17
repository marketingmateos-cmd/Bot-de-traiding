import { MT5DemoExecutionAdapter } from "./mt5DemoExecutionAdapter";
import type { Mt5ClientLike } from "./mt5Client";
import { createUnavailableMt5Client } from "./mt5Client";
import { createMt5SidecarClient } from "./mt5SidecarClient";
import type { TradingExecutionAdapter } from "./types";

/**
 * Same single-lazy-singleton pattern as `src/lib/providers/registry.ts` —
 * one place that decides which concrete `Mt5ClientLike` backs the adapter
 * right now. MT5 REAL BRIDGE: when `MT5_SIDECAR_URL` AND `MT5_SIDECAR_TOKEN`
 * are both set in the environment, this wires `createMt5SidecarClient()` —
 * a real HTTP client talking to `python/mt5_sidecar.py` (Windows only, a
 * real MT5 terminal). With EITHER unset (the default in this sandbox and in
 * any deployment that hasn't set up a sidecar), behavior is UNCHANGED from
 * before this bridge existed: `createUnavailableMt5Client()`, which always
 * reports "not connected" and never fabricates data. Nothing else in the
 * app needs to know which one is active.
 */
let executionAdapter: TradingExecutionAdapter | null = null;

function resolveMt5Client(): Mt5ClientLike {
  const baseUrl = process.env.MT5_SIDECAR_URL;
  const token = process.env.MT5_SIDECAR_TOKEN;
  if (baseUrl && token) {
    return createMt5SidecarClient({ baseUrl, token });
  }
  return createUnavailableMt5Client();
}

export function getMt5ExecutionAdapter(): TradingExecutionAdapter {
  if (!executionAdapter) {
    executionAdapter = new MT5DemoExecutionAdapter(resolveMt5Client());
  }
  return executionAdapter;
}

/**
 * Test-only escape hatch (MT5 Fase 2, spec section 20): lets a test inject a
 * fake `TradingExecutionAdapter` (typically `MT5DemoExecutionAdapter` wired
 * to `makeFakeMt5Client()`) so `prepareMt5ScanContext()` exercises real
 * orchestration code against a mock terminal — never a real MT5 connection,
 * since none exists in this environment. Pass `null` to reset back to the
 * default singleton.
 */
export function setMt5ExecutionAdapterForTesting(adapter: TradingExecutionAdapter | null): void {
  executionAdapter = adapter;
}
