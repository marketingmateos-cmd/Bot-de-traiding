import { NextResponse } from "next/server";
import { getMt5ExecutionAdapter } from "@/lib/execution/registry";
import { getConnectionRow, toPublicView } from "@/lib/execution/mt5ConnectionStore";
import { logAudit } from "@/lib/engines/auditLog";

export async function POST() {
  const adapter = getMt5ExecutionAdapter();
  await adapter.disconnect();
  await logAudit({ action: "MT5_DISCONNECT", entity: "MT5DemoConnection", entityId: "main" });
  const row = await getConnectionRow();
  return NextResponse.json({ ok: true, connection: toPublicView(row) });
}
