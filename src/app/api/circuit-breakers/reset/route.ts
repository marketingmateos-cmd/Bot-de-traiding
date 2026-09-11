import { NextResponse } from "next/server";
import { resetCircuitBreaker } from "@/lib/engines/circuitBreakers";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { name, accountId } = body as { name: string; accountId?: string };
  if (!name) return NextResponse.json({ ok: false, error: "Missing breaker name" }, { status: 400 });

  await resetCircuitBreaker(name);

  if (accountId) {
    const remainingTripped = await prisma.circuitBreaker.count({ where: { isTripped: true } });
    if (remainingTripped === 0) {
      await prisma.paperAccount.update({ where: { id: accountId }, data: { isTradingBlocked: false, blockedReason: null } });
    }
  }

  return NextResponse.json({ ok: true });
}
