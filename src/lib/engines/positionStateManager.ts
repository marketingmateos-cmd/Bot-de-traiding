import { prisma } from "@/lib/db";
import { simulateFill } from "./paperExecution";
import { logAudit } from "./auditLog";
import { createSystemAlert } from "./alerts";
import { toJson } from "@/lib/json";

// Direction / PositionStatus used to be native Prisma enums under Postgres;
// SQLite has no enum type, so the DB columns are plain strings and these
// unions are the TypeScript-side source of truth instead.
type Direction = "LONG" | "SHORT";
type PositionStatus = "FLAT" | "PENDING" | "OPEN" | "PARTIALLY_CLOSED" | "CLOSED" | "ERROR";

/**
 * Position State Manager (spec §19) — THE single source of truth for
 * simulated positions. Every transition is written through one function
 * (`transitionPosition`) so there is exactly one code path that can move a
 * position between states, and every transition is logged to
 * PositionStateChange for audit/reconciliation.
 */

const VALID_TRANSITIONS: Record<PositionStatus, PositionStatus[]> = {
  FLAT: ["PENDING"],
  PENDING: ["OPEN", "ERROR", "FLAT"],
  OPEN: ["PARTIALLY_CLOSED", "CLOSED", "ERROR"],
  PARTIALLY_CLOSED: ["CLOSED", "ERROR"],
  CLOSED: [],
  ERROR: ["FLAT"], // only a manual/reconciliation reset can clear an ERROR position
};

export class InvalidTransitionError extends Error {}

export async function transitionPosition(
  positionId: string,
  toStatus: PositionStatus,
  reason: string,
  source: "manual" | "engine" | "reconciliation" = "engine"
) {
  return prisma.$transaction(async (tx) => {
    const position = await tx.paperPosition.findUnique({ where: { id: positionId } });
    if (!position) throw new Error(`Position ${positionId} not found`);

    const allowed = VALID_TRANSITIONS[position.status as PositionStatus];
    if (!allowed.includes(toStatus)) {
      throw new InvalidTransitionError(
        `Illegal transition ${position.status} -> ${toStatus} for position ${positionId}`
      );
    }

    await tx.positionStateChange.create({
      data: { positionId, fromStatus: position.status, toStatus, reason, source },
    });

    return tx.paperPosition.update({ where: { id: positionId }, data: { status: toStatus } });
  });
}

export interface OpenPositionInput {
  accountId: string;
  assetId: string;
  strategyVersionId: string | null;
  direction: Direction;
  requestedPrice: number;
  quantity: number;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopPct: number | null;
  feeBps: number;
  slippageBps: number;
  riskLevelAtEntry: number;
  gateResult: unknown;
  snapshot: unknown;
}

/**
 * Opens a simulated position atomically: order + fill simulation + position
 * row are created in one DB transaction so it's impossible to end up with an
 * order that "happened" but no position record (the exact failure mode
 * called out in spec §19).
 */
export async function openPosition(input: OpenPositionInput) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.paperOrder.create({
      data: {
        accountId: input.accountId,
        assetId: input.assetId,
        strategyVersionId: input.strategyVersionId,
        direction: input.direction,
        requestedPrice: input.requestedPrice,
        quantity: input.quantity,
        status: "PENDING",
        gateResult: toJson(input.gateResult),
      },
    });

    const fill = simulateFill({
      direction: input.direction,
      requestedPrice: input.requestedPrice,
      quantity: input.quantity,
      feeBps: input.feeBps,
      slippageBps: input.slippageBps,
      idempotencyKey: order.id,
    });

    const filledOrder = await tx.paperOrder.update({
      where: { id: order.id },
      data: {
        status: "FILLED",
        fillPrice: fill.fillPrice,
        slippage: fill.slippageCost,
        fee: fill.fee,
        filledAt: new Date(),
      },
    });

    const position = await tx.paperPosition.create({
      data: {
        accountId: input.accountId,
        assetId: input.assetId,
        strategyVersionId: input.strategyVersionId,
        openOrderId: order.id,
        direction: input.direction,
        status: "OPEN",
        entryPrice: fill.fillPrice,
        quantity: fill.filledQuantity,
        remainingQuantity: fill.filledQuantity,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        trailingStopPct: input.trailingStopPct,
        riskLevelAtEntry: input.riskLevelAtEntry,
        snapshot: toJson(input.snapshot),
      },
    });

    await tx.positionStateChange.create({
      data: { positionId: position.id, fromStatus: null, toStatus: "OPEN", reason: "Orden ejecutada", source: "engine" },
    });

    await tx.paperAccount.update({
      where: { id: input.accountId },
      data: { cashBalance: { decrement: fill.fee } },
    });

    return { order: filledOrder, position, fill };
  });
}

export interface RejectedOrderInput {
  accountId: string;
  assetId: string;
  strategyVersionId: string | null;
  direction: Direction;
  requestedPrice: number;
  quantity: number;
  gateResult: unknown;
  status: "REJECTED" | "LOW_CONFIDENCE";
}

/**
 * Records a candidate order that the Trade Gate blocked or downgraded
 * without ever touching cash or creating a position — this is what makes
 * "operación simulada bloqueada" (spec §42) a real, queryable event instead
 * of something that only ever lived in a log line.
 */
export async function recordRejectedOrder(input: RejectedOrderInput) {
  return prisma.paperOrder.create({
    data: {
      accountId: input.accountId,
      assetId: input.assetId,
      strategyVersionId: input.strategyVersionId,
      direction: input.direction,
      requestedPrice: input.requestedPrice,
      quantity: input.quantity,
      status: input.status,
      gateResult: toJson(input.gateResult),
    },
  });
}

export interface ClosePositionInput {
  positionId: string;
  exitPrice: number;
  reason: string; // STOP_LOSS, TAKE_PROFIT, SIGNAL, MANUAL, RISK, CIRCUIT_BREAKER
  feeBps: number;
  mae: number;
  mfe: number;
  journalExtras?: {
    indicators?: unknown;
    news?: unknown;
    sentiment?: unknown;
    onChain?: unknown;
    aiAnalysis?: unknown;
    aiCritic?: unknown;
    riskScore?: number;
  };
}

export async function closePosition(input: ClosePositionInput) {
  return prisma.$transaction(async (tx) => {
    const position = await tx.paperPosition.findUnique({ where: { id: input.positionId } });
    if (!position) throw new Error(`Position ${input.positionId} not found`);
    if (position.status !== "OPEN" && position.status !== "PARTIALLY_CLOSED") {
      throw new InvalidTransitionError(`Cannot close position in status ${position.status}`);
    }

    const fill = simulateFill({
      direction: position.direction === "LONG" ? "SHORT" : "LONG", // closing is the opposite side
      requestedPrice: input.exitPrice,
      quantity: position.remainingQuantity,
      feeBps: input.feeBps,
      slippageBps: 5,
      idempotencyKey: `close:${position.id}`,
    });

    const sign = position.direction === "LONG" ? 1 : -1;
    const grossPnl = sign * (fill.fillPrice - position.entryPrice) * position.remainingQuantity;
    // grossPnl is derived from fill.fillPrice, which is ALREADY the
    // slippage-adjusted exit price (and position.entryPrice is already the
    // slippage-adjusted entry price) — so slippage is already fully priced
    // into grossPnl via those fill prices. Only the exchange fee is a
    // separate cost still owed. Subtracting fill.slippageCost again here
    // would double-count it (Fase 1.A2 fix — see pnlMath.audit.test.ts).
    const netPnl = grossPnl - fill.fee;
    const durationSeconds = Math.max(0, Math.round((Date.now() - position.openedAt.getTime()) / 1000));

    const trade = await tx.trade.create({
      data: {
        accountId: position.accountId,
        positionId: position.id,
        assetId: position.assetId,
        strategyVersionId: position.strategyVersionId,
        direction: position.direction,
        entryPrice: position.entryPrice,
        exitPrice: fill.fillPrice,
        quantity: position.remainingQuantity,
        fees: fill.fee,
        slippageCost: fill.slippageCost,
        grossPnl,
        netPnl,
        mae: input.mae,
        mfe: input.mfe,
        durationSeconds,
        exitReason: input.reason,
        riskLevelAtEntry: position.riskLevelAtEntry,
        openedAt: position.openedAt,
        closedAt: new Date(),
      },
    });

    await tx.tradeJournal.create({
      data: {
        tradeId: trade.id,
        // position.snapshot is already a JSON string (see openPosition above) — copy as-is.
        signalSnapshot: position.snapshot,
        indicators: toJson(input.journalExtras?.indicators ?? {}),
        news: toJson(input.journalExtras?.news ?? []),
        sentiment: toJson(input.journalExtras?.sentiment ?? {}),
        onChain: toJson(input.journalExtras?.onChain ?? {}),
        aiAnalysis: input.journalExtras?.aiAnalysis !== undefined ? toJson(input.journalExtras.aiAnalysis) : undefined,
        aiCritic: input.journalExtras?.aiCritic !== undefined ? toJson(input.journalExtras.aiCritic) : undefined,
        riskScore: input.journalExtras?.riskScore,
      },
    });

    await tx.paperPosition.update({
      where: { id: position.id },
      data: { status: "CLOSED", remainingQuantity: 0, realizedPnl: { increment: netPnl }, closedAt: new Date() },
    });

    await tx.positionStateChange.create({
      data: { positionId: position.id, fromStatus: position.status, toStatus: "CLOSED", reason: input.reason, source: "engine" },
    });

    // Cash accounting: the entry fee was already deducted when the position
    // was opened. On close we realize netPnl (gross P&L, which already
    // reflects slippage via the fill prices, minus the exit fee) straight
    // into cash — no separate notional movement, since this account model
    // tracks P&L rather than simulating margin/collateral.
    await tx.paperAccount.update({
      where: { id: position.accountId },
      data: { cashBalance: { increment: netPnl } },
    });

    return { trade, netPnl };
  });
}

/**
 * Reconciliation (spec §19): compares DATABASE STATE against itself for
 * internal consistency (we don't have a separate broker to compare against
 * since this is paper trading — the DB *is* the execution state — but we
 * still check for the failure modes called out in the spec: duplicate open
 * positions for the same account+asset+strategy, orphaned FILLED orders
 * without a position, and positions stuck OPEN with zero remaining qty).
 */
export async function reconcilePositions(accountId: string) {
  const openPositions = await prisma.paperPosition.findMany({
    where: { accountId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } },
  });

  const issues: string[] = [];
  const seen = new Map<string, string>();

  for (const pos of openPositions) {
    const key = `${pos.assetId}:${pos.strategyVersionId ?? "none"}:${pos.direction}`;
    if (seen.has(key)) {
      issues.push(`Posiciones abiertas duplicadas detectadas para ${key}: ${seen.get(key)} y ${pos.id}`);
    } else {
      seen.set(key, pos.id);
    }
    if (pos.remainingQuantity <= 0) {
      issues.push(`La posición ${pos.id} está ${pos.status} pero tiene cantidad restante cero.`);
    }
  }

  const orphanedOrders = await prisma.paperOrder.findMany({
    where: { accountId, status: "FILLED", position: null },
  });
  for (const order of orphanedOrders) {
    issues.push(`La orden ${order.id} está EJECUTADA pero no tiene ninguna posición vinculada.`);
  }

  if (issues.length > 0) {
    await prisma.paperAccount.update({
      where: { id: accountId },
      data: { isTradingBlocked: true, blockedReason: `La reconciliación encontró ${issues.length} inconsistencia(s).` },
    });
    await createSystemAlert({
      kind: "POSITION_INCONSISTENCY",
      severity: "CRITICAL",
      title: "Inconsistencia en el estado de posiciones detectada",
      message: issues.join(" | "),
      data: { accountId, issues },
    });
    await logAudit({ action: "RECONCILIATION_FAILED", entity: "PaperAccount", entityId: accountId, data: { issues } });
  }

  return { consistent: issues.length === 0, issues };
}
