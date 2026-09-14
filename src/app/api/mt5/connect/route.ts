import { NextResponse } from "next/server";
import { getMt5ExecutionAdapter } from "@/lib/execution/registry";
import { getConnectionRow, toPublicView } from "@/lib/execution/mt5ConnectionStore";
import { logAudit } from "@/lib/engines/auditLog";

// Credentials arrive here as a request-body parameter ONLY — never
// persisted, never logged, never echoed back. Only the boolean outcome
// (and a pre-redacted error string, see mt5DemoExecutionAdapter.ts) is
// ever written to AuditLog or returned to the client.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { login, password, server } = body as { login?: string; password?: string; server?: string };

  if (!login || !password || !server) {
    return NextResponse.json({ ok: false, error: "login, password y server son obligatorios." }, { status: 400 });
  }

  const adapter = getMt5ExecutionAdapter();
  const result = await adapter.connect({ login, password, server });

  await logAudit({ action: "MT5_CONNECT_ATTEMPT", entity: "MT5DemoConnection", entityId: "main", data: { connected: result.connected, error: result.error } });

  const row = await getConnectionRow();
  return NextResponse.json({ ok: result.connected && !result.error, error: result.error, connection: toPublicView(row) });
}
