/**
 * MT5 Fase 1 — the shared vocabulary for every execution backend. Deliberately
 * separate from `src/lib/providers/types.ts` (`MarketDataProvider`): that
 * interface answers "what did the market do" (read-only, replay/backtest/paper
 * all share it); `TradingExecutionAdapter` answers "place/manage a real order
 * against a real (demo) account" — a fundamentally different, higher-stakes
 * capability that HistoricalReplay must never be able to reach (see the
 * architecture note in mt5DemoExecutionAdapter.ts).
 */

export type Mt5ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "ERROR";

/** What MT5 itself reports about the account — accountType is read verbatim from the terminal, never inferred or assumed. */
export interface Mt5AccountInfo {
  broker: string;
  server: string;
  loginId: string;
  /** Exactly what MT5's own API reports — "DEMO" or "LIVE". Never guessed when absent; treat missing/unrecognized as NOT verified demo. */
  accountType: "DEMO" | "LIVE" | null;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  currency: string;
}

export interface Mt5TerminalInfo {
  connected: boolean;
  /** Round-trip time of the last successful call, ms. Null if never measured. */
  latencyMs: number | null;
}

export interface Mt5Quote {
  symbol: string;
  bid: number;
  ask: number;
  /** ask - bid, in price units (not pips) — the caller converts if it needs pips. */
  spread: number;
  last: number | null;
  timestamp: Date;
}

export interface Mt5SymbolSpec {
  symbol: string;
  /** Smallest allowed price increment. */
  tickSize: number;
  /** Monetary value of one tick move for one lot, in account currency. */
  tickValue: number;
  /** Units of the underlying per 1.0 lot. */
  contractSize: number;
  volumeStep: number;
  volumeMin: number;
  volumeMax: number;
  digits: number;
}

export type OrderSide = "BUY" | "SELL";

export interface PlaceOrderRequest {
  symbol: string;
  side: OrderSide;
  volume: number;
  stopLoss: number;
  takeProfit: number;
  /** Caller-supplied idempotency key (see duplicateOrderGuard.ts) — MT5DemoExecutionAdapter refuses to place a second order for the same key. */
  idempotencyKey: string;
}

export type OrderExecutionStatus = "FILLED" | "REJECTED" | "ERROR";

export interface PlaceOrderResult {
  status: OrderExecutionStatus;
  /** MT5's own ticket id for the resulting position — present only when status is FILLED. */
  ticket: string | null;
  filledPrice: number | null;
  executionLatencyMs: number;
  /** Populated for REJECTED/ERROR — never contains a credential (see executionEventLog.ts's redaction contract). */
  rejectionReason: string | null;
}

/**
 * MT5 Data Connector phase — the historical-data READ surface. Deliberately
 * a plain OHLCV shape compatible with `OHLCVBar` (src/lib/providers/types.ts)
 * so it flows straight into the existing candle validation/import/dataset
 * pipeline (candleValidation.ts, offlineImporter.ts, researchDataset.ts)
 * without any adapter-specific reshaping. `tickVolume`/`spread`/`realVolume`
 * are additional, MT5-specific fields — populated only when MT5 itself
 * reports them reliably for the symbol, never fabricated; see
 * docs/mt5-data-connector.md for which symbols have real vs. proxy volume.
 */
export type Mt5HistoricalTimeframe = "H1" | "H4" | "D1";

export interface Mt5HistoricalBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Canonical OHLCV volume used everywhere else in the pipeline — for MT5 this is tick_volume (see docs), never real_volume, which is 0/unreliable for most FX/CFD symbols. */
  volume: number;
  tickVolume: number | null;
  spread: number | null;
  realVolume: number | null;
}

export interface Mt5Position {
  ticket: string;
  symbol: string;
  side: OrderSide;
  volume: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  unrealizedPnl: number;
  openTime: Date;
}

/**
 * Credentials are a pure runtime parameter — passed into `connect()` and
 * never returned, stored, or held past the call that needs them. No type in
 * this module or the adapter ever persists this shape.
 */
export interface Mt5Credentials {
  login: string;
  password: string;
  server: string;
}

/**
 * The high-level contract every execution backend implements.
 * `HistoricalReplay` and `PaperSimulation` deliberately do NOT implement
 * this interface and never hold a reference to one — see the architecture
 * note in mt5DemoExecutionAdapter.ts for why that separation is structural,
 * not just conventional.
 */
export interface TradingExecutionAdapter {
  readonly id: string;
  connect(credentials: Mt5Credentials): Promise<{ connected: boolean; error: string | null }>;
  disconnect(): Promise<void>;
  getTerminalInfo(): Promise<Mt5TerminalInfo>;
  getAccountInfo(): Promise<Mt5AccountInfo | null>;
  /** The ONE authority on demo-vs-live for this connection. Never bypassable — see demoAccountGuard.ts. */
  verifyAccountIsDemo(): Promise<boolean>;
  getSymbols(): Promise<string[]>;
  getSymbolSpec(symbol: string): Promise<Mt5SymbolSpec | null>;
  getQuote(symbol: string): Promise<Mt5Quote | null>;
  getOpenPositions(): Promise<Mt5Position[]>;
  /**
   * MT5 Data Connector phase — READ-ONLY historical OHLCV, part of the same
   * DATA surface as getAccountInfo/getSymbols/getQuote above (connect,
   * authenticate, verify DEMO, read). Never touches order/position state,
   * never requires the execution Safety Switch. Returns bars strictly
   * within [start, end], ascending by timestamp, exactly as MT5 reports
   * them for that native timeframe — no resampling. See
   * docs/mt5-data-connector.md for the full READ vs EXECUTION separation.
   */
  getHistoricalBars(symbol: string, timeframe: Mt5HistoricalTimeframe, start: Date, end: Date): Promise<Mt5HistoricalBar[]>;
  /**
   * EXECUTION — the one method in this interface that can change account
   * state. Refuses (REJECTED, never throws) unless the account is a
   * verified demo AND the execution safety switch is enabled (both the
   * DB-backed one AND the ENABLE_DEMO_EXECUTION env var) — see
   * mt5DemoExecutionAdapter.ts. Never called by anything in the MT5 Data
   * Connector's ingestion path (src/lib/marketData/mt5HistoricalIngestion.ts) —
   * enforced by a structural test.
   */
  placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult>;
}
