import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";

export interface AuditLogInput {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: unknown;
}

/** Audit Log (spec §48) — append-only record of every important system event. */
export async function logAudit(input: AuditLogInput) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      data: input.data !== undefined ? toJson(input.data) : undefined,
    },
  });
}
