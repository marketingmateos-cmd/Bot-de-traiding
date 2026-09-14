import { prisma } from "@/lib/db";
import type { OrderSide } from "./types";

/**
 * MT5 Fase 1, spec section 18 — one signal must never place two orders,
 * whether the second attempt comes from a retry, a reconnection, a
 * timeout, a UI refresh, or a full bot restart. The key is built from the
 * signal's own identity (never a random/generated id, which a retry would
 * regenerate) and checked against `ExecutionEvent.idempotencyKey`'s unique
 * DB constraint — a real, persisted constraint, not an in-memory Set that
 * a process restart would silently forget.
 */
export interface SignalIdentity {
  strategyId: string;
  symbol: string;
  signalTimestamp: Date;
  direction: OrderSide;
}

export function buildIdempotencyKey(signal: SignalIdentity): string {
  return [signal.strategyId, signal.symbol, signal.signalTimestamp.toISOString(), signal.direction].join(":");
}

/** True if an ExecutionEvent already exists for this exact signal — checked BEFORE ever calling the MT5 client, so a duplicate never even reaches the terminal. */
export async function hasAlreadyExecuted(idempotencyKey: string): Promise<boolean> {
  const existing = await prisma.executionEvent.findUnique({ where: { idempotencyKey } });
  return existing !== null;
}
