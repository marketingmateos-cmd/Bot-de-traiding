import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/engines/auditLog";

/**
 * MVP Bloque 2 — control de qué estrategias usa el bot autónomo.
 * `runPaperTradingScan()` (paperTradingEngine.ts) ya filtra por
 * `strategy: { isActive: true }` desde antes de este bloque — este
 * endpoint es la primera forma de escribir ese campo desde la UI; el
 * campo y el filtro en sí no cambian. Nunca toca MT5, nunca ejecuta una
 * orden, nunca cambia ningún parámetro/versión de la estrategia — solo
 * si el bot la considera en su próximo ciclo.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const { isActive } = body as { isActive?: boolean };

  if (typeof isActive !== "boolean") {
    return NextResponse.json({ ok: false, error: "isActive (boolean) es obligatorio." }, { status: 400 });
  }

  const existing = await prisma.strategy.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Estrategia no encontrada." }, { status: 404 });
  }

  const strategy = await prisma.strategy.update({ where: { id }, data: { isActive } });
  await logAudit({ action: isActive ? "STRATEGY_ACTIVATED" : "STRATEGY_DEACTIVATED", entity: "Strategy", entityId: id, data: { name: existing.name } });

  return NextResponse.json({ ok: true, strategy });
}
