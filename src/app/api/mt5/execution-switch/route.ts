import { NextResponse } from "next/server";
import { canEnableMt5Execution, type Mt5ExecutionEligibilityInput } from "@/lib/execution/demoAccountGuard";
import { getConnectionRow, setExecutionEnabled, toPublicView } from "@/lib/execution/mt5ConnectionStore";
import { logAudit } from "@/lib/engines/auditLog";

// Turning execution OFF is always allowed unconditionally — that's the
// safe direction. Turning it ON re-checks canEnableMt5Execution() against
// the CURRENT connection every time; there is no way to pre-authorize a
// future enable, and no `allowLiveTrading`-style bypass parameter exists
// anywhere in this route or the guard it calls.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { enabled } = body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled (boolean) es obligatorio." }, { status: 400 });
  }

  if (!enabled) {
    await setExecutionEnabled(false);
    await logAudit({ action: "MT5_EXECUTION_DISABLED", entity: "MT5DemoConnection", entityId: "main" });
    return NextResponse.json({ ok: true, connection: toPublicView(await getConnectionRow()) });
  }

  const row = await getConnectionRow();
  const eligibility = await canEnableMt5Execution({
    connectionStatus: (row?.status as Mt5ExecutionEligibilityInput["connectionStatus"]) ?? "DISCONNECTED",
    verifiedDemo: row?.verifiedDemo ?? false,
  });
  if (!eligibility.allowed) {
    return NextResponse.json({ ok: false, error: "No se puede activar MT5 Demo Execution.", reasons: eligibility.reasons }, { status: 400 });
  }

  await setExecutionEnabled(true);
  await logAudit({ action: "MT5_EXECUTION_ENABLED", entity: "MT5DemoConnection", entityId: "main" });
  return NextResponse.json({ ok: true, connection: toPublicView(await getConnectionRow()) });
}
