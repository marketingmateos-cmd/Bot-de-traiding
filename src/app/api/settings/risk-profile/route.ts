import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/engines/auditLog";
import { riskPresetForLevel } from "@/lib/engines/riskEngine";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { accountId, riskLevel } = body as { accountId: string; riskLevel: number };
  if (!accountId || !riskLevel || riskLevel < 1 || riskLevel > 10) {
    return NextResponse.json({ ok: false, error: "Missing or invalid fields" }, { status: 400 });
  }

  // riskProfile stays a derived display label — resolveRiskLimitsForLevel(riskLevel)
  // is the actual source of truth for sizing everywhere it's used.
  const riskProfile = riskPresetForLevel(riskLevel);
  await prisma.paperAccount.update({ where: { id: accountId }, data: { riskLevel, riskProfile } });
  await logAudit({ action: "RISK_LEVEL_CHANGED", entity: "PaperAccount", entityId: accountId, data: { riskLevel, riskProfile } });

  return NextResponse.json({ ok: true });
}
