import { getConnectionRow, markDisconnected, saveConnectionSnapshot, setExecutionEnabled } from "./mt5ConnectionStore";
import { verifyAccountIsDemo } from "./demoAccountGuard";
import type { TradingExecutionAdapter } from "./types";

/**
 * MT5 Fase 2, spec section 9 — Reconnection Safety.
 *
 * Honest scope, stated up front: Phase 1's "never persist credentials" rule
 * (there is no password field anywhere in `MT5DemoConnection` or any store
 * this codebase writes to) makes a SILENT, AUTOMATIC reconnect
 * architecturally impossible — there is nothing to reconnect WITH once the
 * process has no credentials in memory. So this module does not attempt
 * one. What it does instead, every single bot-loop scan
 * (`prepareMt5ScanContext`, never a second scheduler):
 *
 *   1. Re-checks the terminal is actually still connected right now — never
 *      trusts a DB row that merely SAYS "CONNECTED" from a previous tick.
 *   2. Re-verifies the account is still DEMO right now — a reconnect to a
 *      different account, or a broker-side account-type change, must never
 *      be silently inherited as still-DEMO just because the TCP/API
 *      connection is still up.
 *   3. The moment either check fails: execution is force-disabled and the
 *      connection is marked DISCONNECTED — new orders stop immediately,
 *      this same tick.
 *
 * Execution is only ever RE-enabled by an explicit human action through the
 * existing Safety Switch API (POST /api/mt5/execution-switch) — never
 * automatically by this module, and never merely because step 1/2 above
 * passed again after having failed.
 */
export interface Mt5ConnectionSafetyResult {
  safe: boolean;
  reason: string | null;
}

export async function verifyMt5ConnectionSafety(adapter: TradingExecutionAdapter): Promise<Mt5ConnectionSafetyResult> {
  const row = await getConnectionRow();
  if (!row || row.status !== "CONNECTED") {
    return { safe: false, reason: "MT5 no está conectado." };
  }

  const terminalInfo = await adapter.getTerminalInfo();
  if (!terminalInfo.connected) {
    await markDisconnected("Se perdió la conexión con el terminal MT5 (detectado durante el ciclo del bot).");
    return { safe: false, reason: "Se perdió la conexión con el terminal MT5." };
  }

  const accountInfo = await adapter.getAccountInfo();
  const verifiedDemo = verifyAccountIsDemo(accountInfo);
  if (!verifiedDemo) {
    // Still reachable at the transport level, but no longer safe to trade —
    // force the Safety Switch off and record why, rather than relying on
    // `placeOrder`'s own last-mile verifiedDemo check as the only defense.
    await setExecutionEnabled(false);
    await saveConnectionSnapshot({
      status: "CONNECTED",
      statusDetail: "La cuenta conectada ya no se verifica como DEMO — ejecución deshabilitada automáticamente.",
      broker: row.broker,
      server: row.server,
      loginId: row.loginId,
      accountType: accountInfo?.accountType ?? null,
      verifiedDemo: false,
      balance: row.balance,
      equity: row.equity,
      margin: row.margin,
      freeMargin: row.freeMargin,
      leverage: row.leverage,
      currency: row.currency,
      latencyMs: row.latencyMs,
      lastErrorMessage: "La cuenta conectada ya no se verifica como DEMO.",
    });
    return { safe: false, reason: "La cuenta conectada ya no se verifica como DEMO." };
  }

  return { safe: true, reason: null };
}
