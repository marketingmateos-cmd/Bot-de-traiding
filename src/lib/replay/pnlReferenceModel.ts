/**
 * Fase 15 — Replay & Execution Integrity Audit, spec section 9. An
 * INDEPENDENT re-implementation of expected trade P&L, deliberately never
 * importing `replayPortfolio.ts`, `positionStateManager.ts`, or anything
 * from `historicalReplayEngine.ts` — the whole point is to have a second,
 * from-scratch source of truth to compare the engine's own output against,
 * not a wrapper around it.
 *
 * Convention (matches the engine's own, audited convention — see
 * `pnlMath.audit.test.ts` from the earlier P&L audit, and
 * `historicalReplayEngine.ts`'s own `netPnl = grossPnl - fill.fee`):
 * `entryPrice`/`exitPrice` are the ACTUAL fill prices (already reflecting
 * whatever slippage was applied to get there) — this function never adds
 * slippage again on top of them. `fees` is the caller's choice of what to
 * deduct: pass the exit fee alone to reproduce exactly what
 * `ReplayTradeRecord.netPnl` reports for one trade, or entry+exit combined
 * to see the trade's FULL round-trip economic cost (which is what actually
 * leaves the account, since the engine charges the entry fee directly to
 * `ReplayPortfolio.cashBalance` at open time — documented in the Fase 15
 * report, section 6/16).
 */

export interface ReferencePnLInput {
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  notional: number; // entry notional = quantity * entryPrice
  fees: number; // dollar fees to deduct (caller decides which ones — see doc comment above)
}

export interface ReferencePnLResult {
  quantity: number;
  grossPnl: number;
  netPnl: number;
}

export function calculateReferencePnL(input: ReferencePnLInput): ReferencePnLResult {
  if (input.entryPrice <= 0) throw new Error("calculateReferencePnL: entryPrice must be > 0.");
  const quantity = input.notional / input.entryPrice;
  const sign = input.side === "LONG" ? 1 : -1;
  const grossPnl = sign * (input.exitPrice - input.entryPrice) * quantity;
  const netPnl = grossPnl - input.fees;
  return { quantity, grossPnl, netPnl };
}

/** R = realized P&L / initial $ risk (|entryPrice - stopLossPrice| * quantity) — same formula `regimeAnalysis.ts` uses, reimplemented independently here for cross-checking. Null when there is no stop distance to divide by (mirrors the engine's own null-safety). */
export function calculateReferenceRMultiple(netPnl: number, entryPrice: number, stopLossPrice: number, quantity: number): number | null {
  const riskAmount = Math.abs(entryPrice - stopLossPrice) * quantity;
  return riskAmount > 0 ? netPnl / riskAmount : null;
}
