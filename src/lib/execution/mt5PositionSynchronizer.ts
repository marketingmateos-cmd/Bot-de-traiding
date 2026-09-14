import { prisma } from "@/lib/db";
import type { TradingExecutionAdapter } from "./types";

/**
 * MT5 Fase 2, spec section 6/14 — MT5PositionSynchronizer. MT5 is always
 * the source of truth: this function's ONLY job is to make
 * `Mt5DemoPosition` an accurate cache of whatever `adapter.getOpenPositions()`
 * says RIGHT NOW — it never fabricates a position from an order response,
 * never assumes yesterday's cache is still correct, and always removes a
 * cached position whose ticket MT5 no longer reports (closed/expired
 * outside EdgeLab's own knowledge).
 */
export interface Mt5PositionSyncResult {
  synced: number;
  closed: number; // tickets that were cached but MT5 no longer reports — removed, not left stale
}

export async function syncMt5Positions(adapter: TradingExecutionAdapter): Promise<Mt5PositionSyncResult> {
  const livePositions = await adapter.getOpenPositions();
  const liveTickets = new Set(livePositions.map((p) => p.ticket));

  for (const position of livePositions) {
    await prisma.mt5DemoPosition.upsert({
      where: { ticket: position.ticket },
      create: {
        ticket: position.ticket,
        symbol: position.symbol,
        side: position.side,
        volume: position.volume,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        unrealizedPnl: position.unrealizedPnl,
        openTime: position.openTime,
      },
      update: {
        currentPrice: position.currentPrice,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        unrealizedPnl: position.unrealizedPnl,
        lastSyncedAt: new Date(),
      },
    });
  }

  const cached = await prisma.mt5DemoPosition.findMany({ select: { ticket: true } });
  const staleTickets = cached.map((c) => c.ticket).filter((ticket) => !liveTickets.has(ticket));
  if (staleTickets.length > 0) {
    await prisma.mt5DemoPosition.deleteMany({ where: { ticket: { in: staleTickets } } });
  }

  return { synced: livePositions.length, closed: staleTickets.length };
}

export async function getSyncedMt5Positions() {
  return prisma.mt5DemoPosition.findMany({ orderBy: { openTime: "desc" } });
}
