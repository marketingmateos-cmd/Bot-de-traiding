import { prisma } from "@/lib/db";

export interface SystemAlertInput {
  kind: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  title: string;
  message: string;
  data?: unknown;
}

/** Alerts (spec §42) — user-facing notifications for signals, blocks, anomalies, circuit breakers, etc. */
export async function createSystemAlert(input: SystemAlertInput) {
  return prisma.systemAlert.create({
    data: {
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      message: input.message,
      data: (input.data ?? null) as object | undefined,
    },
  });
}

export async function getRecentAlerts(limit = 30) {
  return prisma.systemAlert.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
