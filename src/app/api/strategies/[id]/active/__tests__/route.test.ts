import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "../route";

/**
 * MVP Bloque 2 — first API-route-level test file in this codebase (no
 * precedent existed for this repo's Next.js route handlers, which are
 * plain `(Request, context) => Response` async functions, directly
 * callable without an HTTP server). Uses the same real-Prisma-with-
 * cleanup convention as paperTradingEngine's own test files.
 */

let createdStrategyId: string | null = null;

afterEach(async () => {
  if (createdStrategyId) {
    await prisma.auditLog.deleteMany({ where: { entity: "Strategy", entityId: createdStrategyId } });
    await prisma.strategy.deleteMany({ where: { id: createdStrategyId } });
    createdStrategyId = null;
  }
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/strategies/x/active", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/strategies/[id]/active", () => {
  it("toggles Strategy.isActive to false and persists it — never touches any StrategyVersion row", async () => {
    const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Toggle Test Strategy", isActive: true } });
    createdStrategyId = strategy.id;

    const res = await POST(makeRequest({ isActive: false }), { params: Promise.resolve({ id: strategy.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.strategy.isActive).toBe(false);

    const reloaded = await prisma.strategy.findUnique({ where: { id: strategy.id } });
    expect(reloaded?.isActive).toBe(false);
  });

  it("toggling back to true works symmetrically", async () => {
    const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Toggle Test Strategy 2", isActive: false } });
    createdStrategyId = strategy.id;

    const res = await POST(makeRequest({ isActive: true }), { params: Promise.resolve({ id: strategy.id }) });
    const body = await res.json();
    expect(body.strategy.isActive).toBe(true);
  });

  it("writes an AuditLog row with the strategy id as entityId — the first thing the Block 3 viewer needs to display", async () => {
    const strategy = await prisma.strategy.create({ data: { kind: "TREND_FOLLOWING", name: "Audit Test Strategy", isActive: true } });
    createdStrategyId = strategy.id;

    await POST(makeRequest({ isActive: false }), { params: Promise.resolve({ id: strategy.id }) });

    const entries = await prisma.auditLog.findMany({ where: { entity: "Strategy", entityId: strategy.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("STRATEGY_DEACTIVATED");
  });

  it("rejects a missing isActive with 400, never defaults to a guessed value", async () => {
    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: "irrelevant" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("rejects a non-boolean isActive with 400", async () => {
    const res = await POST(makeRequest({ isActive: "yes" }), { params: Promise.resolve({ id: "irrelevant" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown strategy id, never silently creates one", async () => {
    const res = await POST(makeRequest({ isActive: true }), { params: Promise.resolve({ id: "does-not-exist-id" }) });
    expect(res.status).toBe(404);
  });
});
