import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/engines/auditLog";

const VALID_EVIDENCE_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const {
    isEnabled,
    profitProtectionTriggerPct,
    hardStopLossPct,
    exceptionalMinConfidence,
    exceptionalMinEvidenceLevel,
    exceptionalSizeMultiplier,
  } = body as {
    isEnabled: boolean;
    profitProtectionTriggerPct: number;
    hardStopLossPct: number;
    exceptionalMinConfidence: number;
    exceptionalMinEvidenceLevel: string;
    exceptionalSizeMultiplier: number;
  };

  if (
    typeof isEnabled !== "boolean" ||
    typeof profitProtectionTriggerPct !== "number" ||
    profitProtectionTriggerPct <= 0 ||
    typeof hardStopLossPct !== "number" ||
    hardStopLossPct >= 0 ||
    typeof exceptionalMinConfidence !== "number" ||
    exceptionalMinConfidence < 0 ||
    exceptionalMinConfidence > 1 ||
    !VALID_EVIDENCE_LEVELS.has(exceptionalMinEvidenceLevel) ||
    typeof exceptionalSizeMultiplier !== "number" ||
    exceptionalSizeMultiplier <= 0 ||
    exceptionalSizeMultiplier > 1
  ) {
    return NextResponse.json({ ok: false, error: "Missing or invalid fields" }, { status: 400 });
  }

  const data = { isEnabled, profitProtectionTriggerPct, hardStopLossPct, exceptionalMinConfidence, exceptionalMinEvidenceLevel, exceptionalSizeMultiplier };
  await prisma.profitProtectionConfig.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });
  await logAudit({ action: "PROFIT_PROTECTION_CONFIG_CHANGED", entity: "ProfitProtectionConfig", entityId: "main", data });

  return NextResponse.json({ ok: true });
}
