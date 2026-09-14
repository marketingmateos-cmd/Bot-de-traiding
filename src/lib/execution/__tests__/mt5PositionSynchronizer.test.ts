import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSyncedMt5Positions, syncMt5Positions } from "../mt5PositionSynchronizer";
import { makeFakeMt5Client } from "./testFixtures";
import { MT5DemoExecutionAdapter } from "../mt5DemoExecutionAdapter";
import type { Mt5Position } from "../types";

async function resetPositions() {
  await prisma.mt5DemoPosition.deleteMany({ where: { ticket: { startsWith: "SYNCTEST_" } } });
}

beforeEach(resetPositions);
afterEach(resetPositions);

function position(overrides: Partial<Mt5Position> = {}): Mt5Position {
  return {
    ticket: "SYNCTEST_1",
    symbol: "EURUSDm",
    side: "BUY",
    volume: 0.1,
    entryPrice: 1.1,
    currentPrice: 1.105,
    stopLoss: 1.09,
    takeProfit: 1.12,
    unrealizedPnl: 5,
    openTime: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("MT5 Fase 2, spec section 6 — MT5PositionSynchronizer: open", () => {
  it("a brand-new live position is inserted into Mt5DemoPosition", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ positions: async () => [position()] }));
    const result = await syncMt5Positions(adapter);
    expect(result.synced).toBe(1);
    const rows = await getSyncedMt5Positions();
    const row = rows.find((r) => r.ticket === "SYNCTEST_1");
    expect(row).toBeDefined();
    expect(row?.symbol).toBe("EURUSDm");
    expect(row?.volume).toBe(0.1);
  });
});

describe("MT5 Fase 2, spec section 6 — MT5PositionSynchronizer: update", () => {
  it("a subsequent sync updates currentPrice/stopLoss/takeProfit/unrealizedPnl for an existing ticket, never duplicates the row", async () => {
    const adapter1 = new MT5DemoExecutionAdapter(makeFakeMt5Client({ positions: async () => [position()] }));
    await syncMt5Positions(adapter1);

    const adapter2 = new MT5DemoExecutionAdapter(
      makeFakeMt5Client({ positions: async () => [position({ currentPrice: 1.11, stopLoss: 1.095, takeProfit: 1.13, unrealizedPnl: 15 })] })
    );
    await syncMt5Positions(adapter2);

    const rows = await prisma.mt5DemoPosition.findMany({ where: { ticket: "SYNCTEST_1" } });
    expect(rows).toHaveLength(1); // never duplicated
    expect(rows[0].currentPrice).toBe(1.11);
    expect(rows[0].stopLoss).toBe(1.095);
    expect(rows[0].unrealizedPnl).toBe(15);
    // entryPrice/openTime are NOT part of `update` — immutable identity of the original fill.
    expect(rows[0].entryPrice).toBe(1.1);
  });
});

describe("MT5 Fase 2, spec section 6 — MT5PositionSynchronizer: close", () => {
  it("a ticket MT5 no longer reports is removed from the cache — never left stale", async () => {
    const adapter1 = new MT5DemoExecutionAdapter(makeFakeMt5Client({ positions: async () => [position(), position({ ticket: "SYNCTEST_2" })] }));
    await syncMt5Positions(adapter1);
    expect(await prisma.mt5DemoPosition.count({ where: { ticket: { in: ["SYNCTEST_1", "SYNCTEST_2"] } } })).toBe(2);

    const adapter2 = new MT5DemoExecutionAdapter(makeFakeMt5Client({ positions: async () => [position()] })); // SYNCTEST_2 closed
    const result = await syncMt5Positions(adapter2);
    expect(result.closed).toBe(1);

    const remaining = await prisma.mt5DemoPosition.findMany({ where: { ticket: { in: ["SYNCTEST_1", "SYNCTEST_2"] } } });
    expect(remaining.map((r) => r.ticket)).toEqual(["SYNCTEST_1"]);
  });
});

describe("MT5 Fase 2, spec section 6 — MT5PositionSynchronizer: unknown ticket", () => {
  it("never fabricates a position for a ticket MT5 has never reported — sync only ever mirrors getOpenPositions()", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ positions: async () => [] }));
    await syncMt5Positions(adapter);
    const row = await prisma.mt5DemoPosition.findUnique({ where: { ticket: "SYNCTEST_NEVER_REPORTED" } });
    expect(row).toBeNull();
  });
});
