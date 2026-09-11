import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { closePosition, InvalidTransitionError, openPosition, reconcilePositions, transitionPosition } from "../positionStateManager";

// Integration tests against a real (isolated) Postgres test database — see
// .env.test / vitest.config.ts. Exercises the actual state machine and cash
// accounting, not mocks, since this module's whole job is to be the single
// source of truth for position state (spec §19).

let userId: string;
let assetId: string;
let accountId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `test-${Date.now()}@example.com`, name: "Test User" } });
  userId = user.id;
  const asset = await prisma.asset.create({ data: { symbol: `TST${Date.now() % 100000}`, name: "Test Asset" } });
  assetId = asset.id;
  const account = await prisma.paperAccount.create({
    data: { userId, name: "Test Account", startingBalance: 100, cashBalance: 100 },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { accountId } });
  await prisma.positionStateChange.deleteMany({ where: { position: { accountId } } });
  await prisma.paperPosition.deleteMany({ where: { accountId } });
  await prisma.paperOrder.deleteMany({ where: { accountId } });
  await prisma.paperAccount.delete({ where: { id: accountId } });
  await prisma.asset.delete({ where: { id: assetId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("positionStateManager — openPosition / closePosition", () => {
  it("opens a position atomically: order, fill, and position row all exist together", async () => {
    const { order, position, fill } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      gateResult: { note: "test" },
      snapshot: { note: "test" },
    });

    expect(position.status).toBe("OPEN");
    expect(order.status).toBe("FILLED");
    expect(fill.filledQuantity).toBeGreaterThan(0);

    const dbPosition = await prisma.paperPosition.findUnique({ where: { id: position.id } });
    const dbOrder = await prisma.paperOrder.findUnique({ where: { id: order.id } });
    expect(dbPosition).not.toBeNull();
    expect(dbOrder).not.toBeNull();
    expect(dbPosition!.openOrderId).toBe(order.id);

    const change = await prisma.positionStateChange.findFirst({ where: { positionId: position.id } });
    expect(change?.toStatus).toBe("OPEN");
  });

  it("closes a position and realizes P&L into both the Trade record and the account cash balance", async () => {
    const before = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
    const { position, fill: entryFill } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 120,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      gateResult: {},
      snapshot: {},
    });

    const { trade, netPnl } = await closePosition({
      positionId: position.id,
      exitPrice: 110,
      reason: "TAKE_PROFIT",
      feeBps: 10,
      mae: 0,
      mfe: 0.1,
    });

    expect(trade.exitReason).toBe("TAKE_PROFIT");
    expect(netPnl).toBeCloseTo(trade.netPnl, 6);

    const closedPosition = await prisma.paperPosition.findUniqueOrThrow({ where: { id: position.id } });
    expect(closedPosition.status).toBe("CLOSED");
    expect(closedPosition.remainingQuantity).toBe(0);

    const after = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
    // Cash moves twice for one round trip: the entry fee is deducted
    // immediately on open, then netPnl (which already nets out the EXIT fee
    // and slippage) is credited on close. Isolated via `before` captured
    // immediately prior to this specific open+close.
    expect(after.cashBalance - before.cashBalance).toBeCloseTo(netPnl - entryFill.fee, 6);
  });

  it("refuses to close a position that is not OPEN or PARTIALLY_CLOSED", async () => {
    const { position } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "SHORT",
      requestedPrice: 100,
      quantity: 1,
      stopLoss: 105,
      takeProfit: 90,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      gateResult: {},
      snapshot: {},
    });
    await closePosition({ positionId: position.id, exitPrice: 95, reason: "TAKE_PROFIT", feeBps: 10, mae: 0, mfe: 0 });

    await expect(
      closePosition({ positionId: position.id, exitPrice: 95, reason: "MANUAL", feeBps: 10, mae: 0, mfe: 0 })
    ).rejects.toThrow(InvalidTransitionError);
  });
});

describe("positionStateManager — transitionPosition state machine", () => {
  it("rejects illegal transitions (e.g. CLOSED -> OPEN)", async () => {
    const { position } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      gateResult: {},
      snapshot: {},
    });
    await closePosition({ positionId: position.id, exitPrice: 105, reason: "MANUAL", feeBps: 10, mae: 0, mfe: 0 });

    await expect(transitionPosition(position.id, "OPEN", "attempted illegal reopen", "manual")).rejects.toThrow(InvalidTransitionError);
  });

  it("logs every transition to PositionStateChange", async () => {
    const { position } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      gateResult: {},
      snapshot: {},
    });
    await closePosition({ positionId: position.id, exitPrice: 108, reason: "TAKE_PROFIT", feeBps: 10, mae: 0, mfe: 0 });

    const changes = await prisma.positionStateChange.findMany({ where: { positionId: position.id }, orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => c.toStatus)).toEqual(["OPEN", "CLOSED"]);
  });
});

describe("positionStateManager — reconciliation", () => {
  it("reports consistent when there are no duplicate/orphaned positions", async () => {
    const result = await reconcilePositions(accountId);
    expect(result.consistent).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("detects duplicate open positions for the same account+asset+strategy+direction and blocks the account", async () => {
    await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      gateResult: {},
      snapshot: {},
    });
    await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 101,
      quantity: 1,
      stopLoss: 96,
      takeProfit: 111,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      gateResult: {},
      snapshot: {},
    });

    const result = await reconcilePositions(accountId);
    expect(result.consistent).toBe(false);
    expect(result.issues.some((i) => i.includes("Duplicate open positions"))).toBe(true);

    const account = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.isTradingBlocked).toBe(true);

    // Clean up the duplicate positions this test intentionally created so it
    // doesn't poison later tests/afterAll cleanup ordering.
    const dupPositions = await prisma.paperPosition.findMany({ where: { accountId, status: "OPEN" } });
    for (const p of dupPositions) {
      await prisma.positionStateChange.deleteMany({ where: { positionId: p.id } });
    }
    await prisma.paperPosition.deleteMany({ where: { accountId, status: "OPEN" } });
    await prisma.paperAccount.update({ where: { id: accountId }, data: { isTradingBlocked: false, blockedReason: null } });
  });
});
