import { prisma } from "@/lib/db";
import { maskIdentifier } from "./secretRedaction";
import type { Mt5AccountInfo, Mt5ConnectionStatus } from "./types";

const SINGLETON_ID = "main";

/**
 * MT5 Fase 1 — the only module that writes `MT5DemoConnection`. Its input
 * type structurally cannot carry a password (there is no such field to
 * accept), so this is not "a place that's careful not to persist secrets"
 * — it is a place that has no parameter through which one could arrive.
 */
export interface Mt5ConnectionSnapshot {
  status: Mt5ConnectionStatus;
  statusDetail?: string | null;
  broker?: string | null;
  server?: string | null;
  loginId?: string | null;
  accountType?: "DEMO" | "LIVE" | null;
  verifiedDemo: boolean;
  balance?: number | null;
  equity?: number | null;
  margin?: number | null;
  freeMargin?: number | null;
  leverage?: number | null;
  currency?: string | null;
  latencyMs?: number | null;
  lastErrorMessage?: string | null;
}

export function accountInfoToSnapshot(accountInfo: Mt5AccountInfo, verifiedDemo: boolean, latencyMs: number | null): Mt5ConnectionSnapshot {
  return {
    status: "CONNECTED",
    statusDetail: null,
    broker: accountInfo.broker,
    server: accountInfo.server,
    loginId: accountInfo.loginId,
    accountType: accountInfo.accountType,
    verifiedDemo,
    balance: accountInfo.balance,
    equity: accountInfo.equity,
    margin: accountInfo.margin,
    freeMargin: accountInfo.freeMargin,
    leverage: accountInfo.leverage,
    currency: accountInfo.currency,
    latencyMs,
    lastErrorMessage: null,
  };
}

export async function saveConnectionSnapshot(snapshot: Mt5ConnectionSnapshot) {
  return prisma.mT5DemoConnection.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...snapshot, lastSyncAt: new Date() },
    update: { ...snapshot, lastSyncAt: new Date() },
  });
}

export async function markDisconnected(reason: string | null) {
  return prisma.mT5DemoConnection.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, status: "DISCONNECTED", statusDetail: reason, verifiedDemo: false, executionEnabled: false },
    update: { status: "DISCONNECTED", statusDetail: reason, verifiedDemo: false, executionEnabled: false },
  });
}

export async function markError(reason: string) {
  return prisma.mT5DemoConnection.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, status: "ERROR", statusDetail: reason, lastErrorMessage: reason, verifiedDemo: false, executionEnabled: false },
    update: { status: "ERROR", statusDetail: reason, lastErrorMessage: reason, verifiedDemo: false, executionEnabled: false },
  });
}

export async function setExecutionEnabled(enabled: boolean) {
  return prisma.mT5DemoConnection.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, executionEnabled: enabled },
    update: { executionEnabled: enabled },
  });
}

export async function getConnectionRow() {
  return prisma.mT5DemoConnection.findUnique({ where: { id: SINGLETON_ID } });
}

/** The ONLY shape that should ever leave the server as JSON — loginId masked, and (structurally) no password field exists to leak in the first place. */
export function toPublicView(row: Awaited<ReturnType<typeof getConnectionRow>>) {
  if (!row) {
    return { status: "DISCONNECTED" as Mt5ConnectionStatus, verifiedDemo: false, executionEnabled: false, loginId: null as string | null };
  }
  return {
    status: row.status as Mt5ConnectionStatus,
    statusDetail: row.statusDetail,
    broker: row.broker,
    server: row.server,
    loginId: maskIdentifier(row.loginId),
    accountType: row.accountType,
    verifiedDemo: row.verifiedDemo,
    balance: row.balance,
    equity: row.equity,
    margin: row.margin,
    freeMargin: row.freeMargin,
    leverage: row.leverage,
    currency: row.currency,
    latencyMs: row.latencyMs,
    lastSyncAt: row.lastSyncAt,
    lastErrorMessage: row.lastErrorMessage,
    executionEnabled: row.executionEnabled,
  };
}
