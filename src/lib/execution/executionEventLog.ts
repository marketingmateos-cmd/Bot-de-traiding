import { prisma } from "@/lib/db";
import type { OrderSide } from "./types";

/**
 * MT5 Fase 1, spec section 15 — the execution audit trail. The input type
 * below is deliberately exhaustive about what CAN be logged and, by
 * omission, about what never can be: there is no `password`/`secret`/
 * `token` field anywhere in this type or in the `ExecutionEvent` Prisma
 * model it writes to, so there is nothing here to accidentally leak — not
 * a redaction step applied after the fact, but a shape that cannot hold a
 * credential in the first place.
 */
export interface ExecutionEventInput {
  idempotencyKey?: string | null;
  symbol: string;
  side: OrderSide;
  requestedVolume?: number | null;
  approvedVolume?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskAmount?: number | null;
  rrr?: number | null;
  mt5Ticket?: string | null;
  status: "REJECTED" | "SUBMITTED" | "FILLED" | "ERROR";
  executionLatencyMs?: number | null;
  rejectionReason?: string | null;
}

export async function recordExecutionEvent(input: ExecutionEventInput) {
  return prisma.executionEvent.create({
    data: {
      idempotencyKey: input.idempotencyKey ?? null,
      symbol: input.symbol,
      side: input.side,
      requestedVolume: input.requestedVolume ?? null,
      approvedVolume: input.approvedVolume ?? null,
      entryPrice: input.entryPrice ?? null,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      riskAmount: input.riskAmount ?? null,
      rrr: input.rrr ?? null,
      mt5Ticket: input.mt5Ticket ?? null,
      status: input.status,
      executionLatencyMs: input.executionLatencyMs ?? null,
      rejectionReason: input.rejectionReason ?? null,
    },
  });
}
