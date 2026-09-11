import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/engines/auditLog";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { accountId, riskProfile } = body as { accountId: string; riskProfile: string };
  if (!accountId || !riskProfile) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  await prisma.paperAccount.update({ where: { id: accountId }, data: { riskProfile } });
  await logAudit({ action: "RISK_PROFILE_CHANGED", entity: "PaperAccount", entityId: accountId, data: { riskProfile } });

  return NextResponse.json({ ok: true });
}
