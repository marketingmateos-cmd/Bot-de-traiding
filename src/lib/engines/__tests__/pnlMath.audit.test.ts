import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { closePosition, openPosition } from "../positionStateManager";

// AUDIT TESTS (Crypto AI Trading Lab technical audit — see report). These
// encode the mathematically CORRECT expected P&L behavior, not whatever the
// current implementation happens to do — per the audit brief, a test that
// just mirrors the existing formula proves nothing. Where a test below
// fails, it is documenting a real, confirmed accounting bug, not a broken
// test.
//
// The core question: does netPnl double-count slippage?
//
//   entryPrice stored on a position IS the slipped fill price (worse than
//   the theoretical requested price), and so is exitPrice at close — so
//   grossPnl = sign * (exitPrice - entryPrice) * quantity ALREADY reflects
//   both entry and exit slippage costs via those adjusted prices. The only
//   cost NOT yet reflected in grossPnl is the exchange fee. The
//   mathematically correct netPnl is therefore:
//
//       netPnl = grossPnl - exitFee        (fee only)
//
//   src/lib/engines/positionStateManager.ts's closePosition() instead
//   computes:
//
//       netPnl = grossPnl - exitFee - exitSlippageCost
//
//   which subtracts the exit slippage a second time — once implicitly via
//   the worse fill price baked into grossPnl, and again explicitly as a
//   separate line item. This systematically understates every single
//   trade's netPnl (and therefore every equity/P&L figure derived from it
//   on Dashboard/Portfolio/Journal) by exactly the exit slippage cost.
//   src/lib/engines/backtest.ts:123-124 has the identical formula, so
//   backtest and live paper trading are at least consistent with each
//   other — both are wrong in the same way.

let userId: string;
let assetId: string;
let accountId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `pnl-audit-${Date.now()}@example.com`, name: "PNL Audit" } });
  userId = user.id;
  const asset = await prisma.asset.create({ data: { symbol: `PNL${Date.now() % 100000}`, name: "PNL Audit Asset" } });
  assetId = asset.id;
  const account = await prisma.paperAccount.create({
    data: { userId, name: "PNL Audit Account", startingBalance: 100, cashBalance: 100 },
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

describe("AUDIT: netPnl must reflect slippage exactly once, not twice", () => {
  it("a closed LONG trade's netPnl should equal grossPnl minus the exit fee only", async () => {
    const { position } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 10,
      stopLoss: 90,
      takeProfit: 120,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      riskLevelAtEntry: 5,
      gateResult: {},
      snapshot: {},
    });

    const { trade } = await closePosition({
      positionId: position.id,
      exitPrice: 110,
      reason: "TAKE_PROFIT",
      feeBps: 10,
      mae: 0,
      mfe: 0.1,
    });

    // grossPnl is already computed from the slipped entry/exit fill prices
    // (trade.entryPrice, trade.exitPrice) — it is not a "theoretical, no
    // slippage" number. The only cost left to deduct is the exit fee.
    const correctNetPnl = trade.grossPnl - trade.fees;

    expect(trade.netPnl).toBeCloseTo(correctNetPnl, 6);
  });

  it("account cashBalance change on close should equal grossPnl minus the exit fee (slippage already priced into the fill)", async () => {
    const before = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
    const { position } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 10,
      stopLoss: 90,
      takeProfit: 120,
      trailingStopPct: null,
      feeBps: 10,
      slippageBps: 5,
      riskLevelAtEntry: 5,
      gateResult: {},
      snapshot: {},
    });
    const afterOpen = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
    const entryFeeCharged = before.cashBalance - afterOpen.cashBalance;

    const { trade } = await closePosition({
      positionId: position.id,
      exitPrice: 110,
      reason: "TAKE_PROFIT",
      feeBps: 10,
      mae: 0,
      mfe: 0.1,
    });
    const afterClose = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });

    const correctNetPnl = trade.grossPnl - trade.fees;
    const totalCashDelta = afterClose.cashBalance - before.cashBalance;

    expect(totalCashDelta).toBeCloseTo(correctNetPnl - entryFeeCharged, 6);
  });

  it("known worked example: €100 starting balance, a €10-notional LONG position, price +10%, zero fees — netPnl should be governed only by slippage actually incurred, not double-charged", async () => {
    // feeBps=0 isolates the slippage-only effect the audit brief asked for.
    // A ~2-5bps spread is still applied unconditionally by simulateFill even
    // at slippageBps=0 (real markets always have a spread) — that's expected
    // and not part of what this test is checking.
    const { position } = await openPosition({
      accountId,
      assetId,
      strategyVersionId: null,
      direction: "LONG",
      requestedPrice: 100,
      quantity: 0.1, // €10 notional at price 100
      stopLoss: 80,
      takeProfit: 130,
      trailingStopPct: null,
      feeBps: 0,
      slippageBps: 0,
      riskLevelAtEntry: 5,
      gateResult: {},
      snapshot: {},
    });

    const { trade } = await closePosition({
      positionId: position.id,
      exitPrice: 110, // +10%
      reason: "SIGNAL",
      feeBps: 0,
      mae: 0,
      mfe: 0.1,
    });

    // With zero fees, netPnl should exactly equal grossPnl (nothing left to
    // deduct) — grossPnl already nets out the (small, spread-only) slippage
    // via the fill prices.
    expect(trade.netPnl).toBeCloseTo(trade.grossPnl, 6);
    // And that grossPnl should be close to the ideal, no-cost profit at the
    // ACTUALLY filled quantity (10% of the notional that really filled),
    // off only by the unavoidable spread on each side — never by more than
    // ~1% of notional given the 2-5bps spread range. Scaled by
    // `trade.quantity` rather than the originally requested 0.1: simulateFill
    // occasionally (~8% of orders, seeded by the order's own id) fills only
    // 50-90% of the requested size (see paperExecution.ts's own doc
    // comment) — a real, documented, and here irrelevant source of
    // randomness this test must not be flaky against.
    const idealProfitAtFilledQuantity = trade.quantity * (110 - 100);
    expect(trade.grossPnl).toBeGreaterThan(idealProfitAtFilledQuantity * 0.9);
    expect(trade.grossPnl).toBeLessThan(idealProfitAtFilledQuantity);
  });
});
