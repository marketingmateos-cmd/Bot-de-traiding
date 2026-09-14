import type { Mt5ClientLike } from "./mt5Client";
import { verifyAccountIsDemo as verifyDemoPure, LIVE_ACCOUNT_BLOCKED_MESSAGE } from "./demoAccountGuard";
import { redactSecret } from "./secretRedaction";
import { accountInfoToSnapshot, getConnectionRow, markDisconnected, markError, saveConnectionSnapshot } from "./mt5ConnectionStore";
import { hasAlreadyExecuted, buildIdempotencyKey, type SignalIdentity } from "./duplicateOrderGuard";
import { recordExecutionEvent } from "./executionEventLog";
import type {
  Mt5AccountInfo,
  Mt5Credentials,
  Mt5Position,
  Mt5Quote,
  Mt5SymbolSpec,
  Mt5TerminalInfo,
  PlaceOrderRequest,
  PlaceOrderResult,
  TradingExecutionAdapter,
} from "./types";

/**
 * MT5 Fase 1 — the ONLY class in this codebase allowed to reach a real (or,
 * today, real-but-unavailable — see mt5Client.ts) MetaTrader 5 terminal.
 *
 * ARCHITECTURE INVARIANT (spec section 1): `HistoricalReplay`
 * (src/lib/replay/*) and `PaperSimulation` (paperTradingEngine.ts,
 * engines/paperExecution.ts, engines/positionStateManager.ts) do not
 * import anything from this module, do not implement `TradingExecutionAdapter`,
 * and never hold a reference to an `Mt5ClientLike`. This is not merely
 * convention: `HistoricalReplay`'s only market-data entry point is
 * `historicalDataProvider.ts::getHistoricalBars` (SYNTHETIC or
 * HISTORICAL_REAL, both pure reads from generated data or `MarketData`),
 * and its only portfolio state is the in-memory `ReplayPortfolio` object —
 * neither one has any code path that could construct or call an
 * `Mt5ClientLike`. Grep for "Mt5" or "execution/" in `src/lib/replay/` to
 * verify this holds at any point in time.
 *
 * Every state-changing method re-derives DEMO status from the CURRENT
 * connection on every call rather than trusting a cached flag — a
 * disconnect-and-reconnect-to-a-different-account can never inherit a
 * stale `verifiedDemo: true`.
 */
export class MT5DemoExecutionAdapter implements TradingExecutionAdapter {
  readonly id = "mt5-demo";

  constructor(private readonly client: Mt5ClientLike) {}

  async connect(credentials: Mt5Credentials): Promise<{ connected: boolean; error: string | null }> {
    const startedAt = Date.now();
    const result = await this.client.login(credentials);
    const latencyMs = Date.now() - startedAt;

    if (!result.ok) {
      // Defense in depth: even though `result.error` should never contain
      // the password (the client contract forbids it), redact it anyway
      // before it can reach a DB row, a log line, or an API response.
      const safeError = result.error ? redactSecret(result.error, credentials.password) : "MT5 login failed";
      await markError(safeError);
      return { connected: false, error: safeError };
    }

    const accountInfo = await this.client.accountInfo();
    if (!accountInfo) {
      const safeError = "MT5 login succeeded but no account info was returned.";
      await markError(safeError);
      return { connected: false, error: safeError };
    }

    const verifiedDemo = verifyDemoPure(accountInfo);
    await saveConnectionSnapshot(accountInfoToSnapshot(accountInfo, verifiedDemo, latencyMs));
    // Every fresh connection starts with execution OFF regardless of any
    // previous session — see canEnableMt5Execution() for how it's turned
    // back on, always explicitly, never automatically on reconnect.
    if (!verifiedDemo) {
      return { connected: true, error: LIVE_ACCOUNT_BLOCKED_MESSAGE };
    }
    return { connected: true, error: null };
  }

  async disconnect(): Promise<void> {
    await this.client.logout();
    await markDisconnected(null);
  }

  async getTerminalInfo(): Promise<Mt5TerminalInfo> {
    const startedAt = Date.now();
    const connected = await this.client.isConnected();
    return { connected, latencyMs: connected ? Date.now() - startedAt : null };
  }

  async getAccountInfo(): Promise<Mt5AccountInfo | null> {
    return this.client.accountInfo();
  }

  async verifyAccountIsDemo(): Promise<boolean> {
    const accountInfo = await this.client.accountInfo();
    const verifiedDemo = verifyDemoPure(accountInfo);
    const row = await getConnectionRow();
    if (row) {
      await saveConnectionSnapshot({
        status: verifiedDemo ? "CONNECTED" : row.status === "CONNECTED" ? "CONNECTED" : "DISCONNECTED",
        broker: row.broker,
        server: row.server,
        loginId: row.loginId,
        accountType: accountInfo?.accountType ?? null,
        verifiedDemo,
        balance: row.balance,
        equity: row.equity,
        margin: row.margin,
        freeMargin: row.freeMargin,
        leverage: row.leverage,
        currency: row.currency,
        latencyMs: row.latencyMs,
        lastErrorMessage: verifiedDemo ? null : LIVE_ACCOUNT_BLOCKED_MESSAGE,
      });
    }
    return verifiedDemo;
  }

  async getSymbols(): Promise<string[]> {
    return this.client.symbols();
  }

  async getSymbolSpec(symbol: string): Promise<Mt5SymbolSpec | null> {
    return this.client.symbolInfo(symbol);
  }

  async getQuote(symbol: string): Promise<Mt5Quote | null> {
    return this.client.quote(symbol);
  }

  async getOpenPositions(): Promise<Mt5Position[]> {
    return this.client.positions();
  }

  /**
   * Spec section 8/16 — the gate every order must clear, re-checked live
   * against the DB every single call (never a value cached on `this`):
   *
   *  1. an ExecutionEvent for this exact idempotencyKey doesn't already exist;
   *  2. the connection is CONNECTED;
   *  3. verifiedDemo is true for the CURRENT connection;
   *  4. the executionEnabled Safety Switch is on.
   *
   * The full 15-point pre-flight checklist from spec section 8 (Risk
   * Engine, Trade Gate, daily/total limits, RRR, symbol availability,
   * market conditions) is the bot loop's responsibility once MT5 is wired
   * into it (Phase 2) — this method is the adapter's OWN, unconditional
   * safety net underneath that, not a replacement for it.
   */
  async placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
    if (await hasAlreadyExecuted(request.idempotencyKey)) {
      return { status: "REJECTED", ticket: null, filledPrice: null, executionLatencyMs: 0, rejectionReason: "Señal duplicada: ya existe una ejecución registrada para este idempotencyKey." };
    }

    const row = await getConnectionRow();
    if (!row || row.status !== "CONNECTED") {
      return this.rejectAndLog(request, "MT5 no está conectado.");
    }
    if (!row.verifiedDemo) {
      return this.rejectAndLog(request, LIVE_ACCOUNT_BLOCKED_MESSAGE);
    }
    if (!row.executionEnabled) {
      return this.rejectAndLog(request, "MT5 Demo Execution está desactivado (Safety Switch OFF).");
    }

    const startedAt = Date.now();
    const result = await this.client.orderSend(request);
    const executionLatencyMs = Date.now() - startedAt;

    await recordExecutionEvent({
      idempotencyKey: request.idempotencyKey,
      symbol: request.symbol,
      side: request.side,
      requestedVolume: request.volume,
      approvedVolume: result.status === "FILLED" ? request.volume : null,
      entryPrice: result.filledPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      mt5Ticket: result.ticket,
      status: result.status,
      executionLatencyMs,
      rejectionReason: result.rejectionReason,
    });

    return { ...result, executionLatencyMs };
  }

  private async rejectAndLog(request: PlaceOrderRequest, reason: string): Promise<PlaceOrderResult> {
    await recordExecutionEvent({
      idempotencyKey: request.idempotencyKey,
      symbol: request.symbol,
      side: request.side,
      requestedVolume: request.volume,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      status: "REJECTED",
      rejectionReason: reason,
    });
    return { status: "REJECTED", ticket: null, filledPrice: null, executionLatencyMs: 0, rejectionReason: reason };
  }
}

/** Convenience for building a SignalIdentity-derived idempotencyKey without importing duplicateOrderGuard.ts directly at every call site. */
export function buildOrderIdempotencyKey(signal: SignalIdentity): string {
  return buildIdempotencyKey(signal);
}
