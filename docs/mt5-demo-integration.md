# MT5 Demo Integration (Fase 1 — fundación segura)

**EdgeLab AI's MT5 integration is restricted to demo accounts in this version.**
There is no live account support, no live execution path, no way to select a
live account, and no hidden parameter to bypass the demo check. This document
explains what exists today, how it's structured, and what is intentionally
not built yet.

## Why demo-only, structurally (not just by convention)

`verifyAccountIsDemo()` (`src/lib/execution/demoAccountGuard.ts`) is the single
authority on demo-vs-live. It reads `accountType` exactly as MetaTrader 5
itself reports it — `"DEMO"` or `"LIVE"` — and treats anything else (missing,
null, unrecognized) as **not verified demo**, never as safe-by-default. There
is no `allowLiveTrading` parameter anywhere in this codebase, and the message
shown for a live account is fixed:

> Live accounts are disabled. EdgeLab AI only supports MT5 demo accounts.

## Architecture

```
Strategy → Signal → AI Analyst → AI Critic → Trade Gate → Risk Engine
  → Circuit Breakers → Execution Adapter → MT5 DEMO ONLY
```

Three execution paths are kept structurally separate:

- **HistoricalReplay** (`src/lib/replay/`) — reads only `MarketData`
  (SYNTHETIC or HISTORICAL_REAL) and never imports anything from
  `src/lib/execution/`. Verified by a repo-grep test (see Tests below).
- **PaperSimulation** (`paperTradingEngine.ts`, `engines/paperExecution.ts`,
  `engines/positionStateManager.ts`) — simulates fills in-process, also
  never imports `src/lib/execution/`.
- **MT5 Demo** (`src/lib/execution/`) — the only path that can reach a real
  (demo) broker account.

`TradingExecutionAdapter` (`src/lib/execution/types.ts`) is the interface;
`MT5DemoExecutionAdapter` (`src/lib/execution/mt5DemoExecutionAdapter.ts`) is
its only implementation.

## Why MT5 can't be connected to for real, here

Unlike Binance, MetaTrader 5 has no public REST API. Its official API (the
`MetaTrader5` Python package, or a ZeroMQ/DLL Expert Advisor bridge) only
works against a real MT5 terminal process running on the **same machine**
(Windows, or Wine) — there is nothing to call over the network. This
sandboxed development environment cannot run a real MT5 terminal, so:

- `src/lib/execution/mt5Client.ts` defines `Mt5ClientLike` — an injectable,
  low-level interface (same dependency-injection pattern as the Binance
  importer's `FetchLike`). Every test injects a fake implementation.
- `createUnavailableMt5Client()` is the only implementation shipped in this
  repo — it always reports "not connected" and explains why, rather than
  pretending a connection exists. This is what `src/lib/execution/registry.ts`
  wires up by default.
- A real deployment would supply its own `Mt5ClientLike` (e.g. a small
  Windows-side companion process talking to a real MT5 terminal) — a
  one-line change in `registry.ts`, nothing else in the app needs to know.

**This means: nothing in this codebase has ever connected to, or been tested
against, a real MT5 terminal.** Every test uses a fake `Mt5ClientLike`.

## Credentials

`Mt5Credentials { login, password, server }` is a pure runtime parameter to
`TradingExecutionAdapter.connect()`. It is never stored:

- No Prisma model has a password field — `MT5DemoConnection` stores only
  non-secret connection metadata (`broker`, `server`, `loginId` — an account
  *number*, not a secret — `accountType`, `balance`/`equity`/etc.).
- Every error message that could theoretically echo a credential is passed
  through `redactSecret()` (`src/lib/execution/secretRedaction.ts`) before it
  can reach a log line, a DB row, or an API response.
- `loginId` is masked (`maskIdentifier()`) in every API/UI surface — only the
  last 2 characters are ever shown.

## Safety Switch (spec section 16)

`MT5DemoConnection.executionEnabled` defaults to `false` and is the **only**
field `MT5DemoExecutionAdapter.placeOrder()` checks (re-read from the DB on
every call, never cached) before allowing an order. Turning it on requires
`canEnableMt5Execution()` (`demoAccountGuard.ts`) to pass:

- connection status is `CONNECTED`;
- `verifiedDemo` is `true` for the **current** connection;
- no circuit breaker is tripped.

Every fresh `connect()` call resets `executionEnabled` back to `false` —
reconnecting, or restarting the process, never inherits a previous "enabled"
state.

Two preconditions from the original spec — **"evaluation profile
selected"** and a standalone **"risk engine OK"** — have no corresponding
concept in this codebase yet (there is no prop-firm-style Evaluation
framework at all today; see Limitations) and are deliberately not faked
with an always-true check.

## Duplicate order protection (spec section 18)

`ExecutionEvent.idempotencyKey` (built from `strategyId:symbol:signalTimestamp:direction`
via `buildIdempotencyKey()`) has a **unique** DB constraint — not an
in-memory lock, so it survives a bot restart. `placeOrder()` checks for an
existing row with the same key before ever calling the MT5 client; a retry,
reconnection, timeout, UI refresh, or restart can never place a second order
for the same signal.

## Execution log (spec section 15)

`ExecutionEvent` records every attempt (symbol, side, volumes, entry, SL/TP,
ticket, status, latency, rejection reason). Its shape has no field that could
ever hold a credential — there is nothing to redact because nothing secret is
ever passed into it.

## UI

`/accounts` (`src/components/accounts/Mt5AccountCard.tsx`) shows connection
status, broker/server/masked login, balance/equity/margin/leverage/currency,
latency, last sync, and the Safety Switch — with a prominent **DEMO ONLY**
badge and no "Enable Live Trading" control anywhere.

## What is NOT built yet (deferred to later phases)

This is Phase 1 — the safety/architecture foundation — not the full 29-point
spec. Explicitly deferred:

- **Evaluation Risk Engine** (phases, profit target, total safety/hard
  stop, risk-per-trade profiles) — 100% new territory, doesn't exist in any
  form today beyond a flat 20% lifetime-drawdown circuit breaker.
- **MT5SymbolMapper** (broker-specific symbol name mapping, e.g.
  `BTCUSDm` → `BTC`).
- **MT5PositionSynchronizer** (periodic position/P&L sync against MT5 as
  the source of truth).
- **Bot loop integration** — `MT5DemoExecutionAdapter.placeOrder()` exists
  and enforces its own safety gate, but is not yet wired into
  `runPaperTradingScan`/`botLoop.ts`. The full 15-point pre-flight checklist
  (Risk Engine sizing with lot step/contract size/tick value, Trade Gate,
  daily/total limits, RRR, symbol availability, market conditions) is bot
  loop integration work for Phase 2.
- **Position sizing for MT5** — `riskEngine.ts`'s `calculatePositionSize` is
  crypto-style (continuous quantity); MT5 needs lot step/min/max volume,
  contract size, and tick value folded in — not yet done.
- **News/economic calendar/weekend hooks** — no real provider exists; a
  future implementation must show "NOT AVAILABLE" honestly rather than
  fake a filter.
- **Reconnection logic** beyond resetting the Safety Switch — full
  "detect disconnect → stop new signals → reconnect → re-verify demo →
  resync positions → only then resume" sequencing needs the bot loop
  integration above to exist first.

## Tests

`src/lib/execution/__tests__/mt5DemoExecutionAdapter.test.ts` (27 tests):
demo accepted, live rejected, missing account info rejected, disconnected
terminal, credentials never logged (including an adversarial error message
that contains the password), credentials never persisted, execution disabled
by default, Safety Switch preconditions (disconnected / not-demo / breaker
tripped / all clear), reconnection resets the switch, duplicate order
protection, AI cannot smuggle an approval through the eligibility check or
the order request, and a repo-grep proof that `HistoricalReplay` and
`PaperSimulation` never import `src/lib/execution/`.
