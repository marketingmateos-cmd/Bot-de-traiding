import { MT5DemoExecutionAdapter } from "./mt5DemoExecutionAdapter";
import { createUnavailableMt5Client } from "./mt5Client";
import type { TradingExecutionAdapter } from "./types";

/**
 * Same single-lazy-singleton pattern as `src/lib/providers/registry.ts` —
 * one place that decides which concrete `Mt5ClientLike` backs the adapter
 * right now. Today that's always `createUnavailableMt5Client()`: this repo
 * ships no real MT5 bridge (see mt5Client.ts's doc comment for why a real
 * one can't be tested from this environment). Wiring a real backend later
 * is a one-line change here — nothing else in the app needs to know.
 */
let executionAdapter: TradingExecutionAdapter | null = null;

export function getMt5ExecutionAdapter(): TradingExecutionAdapter {
  if (!executionAdapter) {
    executionAdapter = new MT5DemoExecutionAdapter(createUnavailableMt5Client());
  }
  return executionAdapter;
}
