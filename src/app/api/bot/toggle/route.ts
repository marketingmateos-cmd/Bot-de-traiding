import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/engines/auditLog";
import { ensureBotConfig } from "@/lib/botLoop";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { isActive } = body as { isActive: boolean };

  await ensureBotConfig();
  const config = await prisma.botConfig.update({
    where: { id: "main" },
    data: { isActive, status: isActive ? "WAITING" : "PAUSED", statusDetail: null },
  });
  await logAudit({ action: isActive ? "BOT_ACTIVATED" : "BOT_PAUSED", entity: "BotConfig", entityId: "main" });

  return NextResponse.json({ ok: true, config });
}
