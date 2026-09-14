# MT5 Demo Integration (Fase 1 + Fase 2)

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
Market Data → Strategy → Signal → AI Analyst → AI Critic → Trade Gate
  → Risk Engine → Evaluation Risk Layer → Circuit Breakers
  → MT5 Demo Guard → MT5 Demo Execution Adapter
```

Any single layer rejecting a candidate means NO ORDER — every layer runs
unconditionally and independently; none of them trusts a summary flag from
an earlier layer as a substitute for its own check (see "15-point execution
checklist" below).

Three execution paths are kept structurally separate:

- **HistoricalReplay** (`src/lib/replay/`) — reads only `MarketData`
  (SYNTHETIC or HISTORICAL_REAL) and never imports anything from
  `src/lib/execution/`. Verified by a repo-grep test (see Tests below).
- **PaperSimulation** (`engines/paperExecution.ts`,
  `engines/positionStateManager.ts`, `engines/positionLifecycle.ts`) — the
  pure paper-simulation internals, and still never import
  `src/lib/execution/`. `paperTradingEngine.ts` itself is the ONE
  exception (Fase 2): it imports exactly one module,
  `src/lib/execution/mt5ExecutionOrchestrator.ts`, as a small additive hook
  — see "Bot Loop integration" below. Both invariants are enforced by a
  repo-grep test (see Tests).
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

## Evaluation Risk Engine (Fase 2, spec section 1)

`src/lib/evaluation/evaluationRiskEngine.ts` (pure logic) +
`src/lib/evaluation/evaluationAccountStore.ts` (Prisma persistence) — a
prop-firm-style evaluation layered ON TOP of the MT5 demo connection, kept
deliberately separate from the paper account's own Risk Level 1-10 dial.

Profiles: `20K` / `50K` / `100K` (same rule template, different
`initialBalance`) or `CUSTOM` (every field explicit — never a silent
default). The shared template: Phase 1 target **+10%**, Phase 2 target
**+5%**, Daily Safety Stop **-3%** (blocks new entries, doesn't fail),
Daily Hard Limit **-5%** (FAILED), Total Safety Stop **-6%** (risk
1% → 0.5%, reason `TOTAL_DRAWDOWN_PROTECTION`), Total Hard Limit **-10%**
(FAILED), Base Risk **1%**, Minimum RRR **1.5**.

`evaluateEvaluationAccount()` is pure and **sticky** for terminal states:
once `FAILED` or `TARGET_REACHED`, it stays that way forever — a failed
evaluation never un-fails on a later equity recovery, and a target reached
never resumes trading on a later dip. `syncEvaluationAccount()` persists a
FRESH transition into either terminal state exactly once (alert + audit
log), driven by the bot loop, never re-fired every tick spent in the same
state. Advancing `PHASE_1` → `PHASE_2` after `TARGET_REACHED` is a
**separate, explicit** action (`advanceToPhase2()` /
`POST /api/mt5/evaluation/advance-phase2`) — never automatic.

Day-boundary bookkeeping (spec section 11) is always computed in **UTC**,
shifted by a configurable `resetHourUtc` (`computeEvaluationDayKey()`) —
never server-local time, so a day never resets at the wrong moment
depending on where the process happens to be deployed.

## Bot Loop integration (Fase 2, spec section 2)

No second scheduler. `paperTradingEngine.ts`'s existing scan loop
(`runPaperTradingScanExclusive`, driven by the existing `botLoop.ts`) calls
`prepareMt5ScanContext()` once per scan (mirrors how it already computes
`riskLimits`/`profitProtection` once) and, for every candidate the paper
pipeline already evaluated, `attemptMt5DemoExecution()` — a small,
additive, parallel attempt using the SAME signal/entry/SL/TP/Trade-Gate
verdict, never a second AI evaluation. A rejection or error here never
affects paper trading's own decision, and vice versa: two independent
account states, one shared pipeline. When MT5 isn't connected+enabled,
`prepareMt5ScanContext()` returns `null` immediately and every candidate
simply skips MT5 for that scan — Historical Replay and Paper Trading are
completely unaffected either way (spec section 19).

MT5 execution only ever attempts on a **strict** Trade Gate `APPROVED`
verdict — never `LOW_CONFIDENCE` (unlike paper trading, which still trades
LOW_CONFIDENCE at half size). A deliberately more conservative bar for
real (even if demo) broker execution.

## 15-point execution checklist (Fase 2, spec section 3)

`src/lib/execution/executionChecklist.ts`'s `runMt5ExecutionChecklist()` —
every check **always** runs (never short-circuits, same philosophy as
`tradeGate.ts`), so the audit trail is always complete; the array order is
what decides `failedCheck` when more than one fails:
`SYMBOL_AVAILABLE`, `MT5_CONNECTED`, `ACCOUNT_VERIFIED_DEMO`,
`SAFETY_SWITCH_ON`, `EVALUATION_ACCOUNT_ACTIVE`, `EVALUATION_NOT_FAILED`,
`EVALUATION_TARGET_NOT_REACHED`, `DAILY_LIMITS_OK`, `TOTAL_LIMITS_OK`,
`RISK_ENGINE_APPROVES`, `TRADE_GATE_APPROVES`, `MAX_OPEN_POSITIONS_OK`,
`EXPOSURE_OK`, `CONCENTRATION_OK`, `CORRELATION_OK`, `SL_TP_RRR_VALID`. On
rejection, `ExecutionEvent` gets `rejectionReason`, `failedCheck`,
`timestamp`, `symbol`, `signalId` (the deliberate 16th "SYMBOL_AVAILABLE"
pre-check makes the numbered 15 always meaningful even when the symbol
can't be resolved at all).

## MT5 position sizing (Fase 2, spec section 4)

`src/lib/execution/mt5PositionSizing.ts`'s `calculateMt5PositionSize()` —
lot-based sizing using the symbol's own broker-reported metadata
(`tickValue`, `tickSize`, `contractSize`, `volumeStep`/`Min`/`Max`), a
fundamentally different calculation from `riskEngine.ts`'s crypto-style
continuous-quantity `calculatePositionSize` (which paper trading keeps
using, untouched). Volume is **floored** to `volumeStep` — never rounded
up — so actual monetary risk is always ≤ the requested risk amount; if
flooring lands below `volumeMin`, this **rejects** rather than rounding up
to the minimum (which would silently exceed approved risk). Invalid/
non-finite symbol metadata, a zero-or-negative stop distance, or a
zero-or-negative risk amount all reject rather than guess. An optional
`maxApprovedNotional` (the Risk Engine's own exposure-clamped ceiling)
narrows the volume further, never widens it.

## MT5SymbolMapper (Fase 2, spec section 5)

`src/lib/execution/mt5SymbolMapper.ts` — an explicit EdgeLab-symbol →
MT5-broker-symbol table (`Mt5SymbolMapping`), never assumed equal (`BTC`
might be `BTCUSD`, `BTCUSDT`, or `BTCUSDm` depending entirely on the
connected broker). `resolveMt5Symbol()` looks up the mapping, checks it's
`enabled`, and validates the mapped symbol against the **live** terminal's
`adapter.getSymbols()` — a mapping that was valid yesterday but the broker
removed (or was simply never enabled) is rejected, never used anyway.

## MT5PositionSynchronizer (Fase 2, spec section 6)

`src/lib/execution/mt5PositionSynchronizer.ts`'s `syncMt5Positions()` —
MT5 is always the source of truth: `Mt5DemoPosition` is a pure CACHE of
`adapter.getOpenPositions()`'s last successful read (ticket, symbol, side,
volume, entryPrice, currentPrice, stopLoss, takeProfit, unrealizedPnL,
openTime), refreshed every sync, never written to speculatively from an
order response alone, and any cached ticket MT5 no longer reports is
deleted — "EdgeLab never assumes an order executed" holds for positions
disappearing too, not just appearing.

## Order lifecycle & duplicate protection (Fase 2, spec sections 7/8)

`src/lib/execution/mt5ExecutionOrchestrator.ts`'s `attemptMt5DemoExecution()`
is the full lifecycle: signal → risk calculated (sizing + exposure) →
evaluation checks → checklist → execution request → MT5 Demo → execution
response → confirm position (only from the adapter's own result, never
assumed) → synchronize internal state. If MT5 errors on an order that
cleared all 15 checks, the `ExecutionEvent` is relabelled
`FAILED_EXECUTION` (distinct from a pre-flight `REJECTED` that was never
even sent) and **no fictitious position** is ever created — only a
`FILLED` result ever triggers a position sync.

Duplicate protection reuses the existing `idempotencyKey` system
(`strategyId:symbol:signalTimestamp:direction`, unique DB constraint) — the
orchestrator checks `hasAlreadyExecuted()` both before logging a
REJECTED row and before ever calling `placeOrder()` again, so a retry,
reconnect, restart, or UI refresh can never create two execution requests
**and** can never overwrite a previously-FILLED row's status with a stale
duplicate-guard rejection.

## Reconnection safety (Fase 2, spec section 9)

`src/lib/execution/mt5ReconnectionGuard.ts`'s `verifyMt5ConnectionSafety()`
runs on **every** bot-loop scan (via `prepareMt5ScanContext()`), never a
second scheduler. Honest scope, stated up front: Phase 1's "never persist
credentials" rule makes a silent, automatic reconnect architecturally
impossible — there is no stored password to reconnect with. So this module
does not attempt one. What it does do, every scan: re-verify the terminal
is still reachable (`adapter.getTerminalInfo()`) and the account is still
DEMO (`adapter.getAccountInfo()` + `verifyAccountIsDemo()`) — never trusts
a stale "CONNECTED" DB row. The moment either check fails, execution is
force-disabled and the connection marked `DISCONNECTED` **this same tick**.
Execution is only ever re-enabled by an explicit human action through the
existing Safety Switch API — never automatically, and never merely because
the terminal became reachable again.

## Account synchronization & daily reset (Fase 2, spec sections 10/11)

`prepareMt5ScanContext()` refreshes `MT5DemoConnection`'s
balance/equity/margin/freeMargin/leverage/currency from the live adapter
before anything else reads them that scan — but never overwrites the
Evaluation Account's own configured rules; the two stay clearly separate
tables with a clearly separate write path (`syncEvaluationAccount()` vs
`saveConnectionSnapshot()`). Daily reset — see Evaluation Risk Engine above.

## Target reached & risk reduction (Fase 2, spec sections 12/13)

Reaching the phase's profit target sets `TARGET_REACHED` (blocks new
entries) and persists `targetReachedAt`, `daysToTarget`, `finalEquity`,
`finalBalance`; `totalTrades` is computed on demand from
`ExecutionEvent.count({status:"FILLED", createdAt >= startedAt})` rather
than a separately-maintained counter that could drift. Total drawdown
≤ -6% halves `currentRiskPct` (1% → 0.5%) with `currentRiskReason:
"TOTAL_DRAWDOWN_PROTECTION"` — visible in both `/accounts` and the
Dashboard's MT5 summary. Nothing in the AI pipeline (Analyst/Critic) can
touch this value; it is derived purely from `totalPnlPct` vs.
`totalSafetyPct`.

## UI (Fase 2, spec section 14)

`/accounts`:

- `Mt5AccountCard` (existing, extended) — connection status,
  broker/server/masked login, balance/equity/margin/leverage/currency,
  latency, last sync, Safety Switch, and now **Execution Status** / **Last
  Order** / **Last Error** from the most recent `ExecutionEvent`.
- `EvaluationAccountCard` (new) — Profile, Phase, Target, Target Progress,
  Daily DD, Total DD, Base Risk, Current Risk (+ reason), Status, plus the
  two explicit human actions: start/restart an evaluation from a template,
  and advance a `TARGET_REACHED` `PHASE_1` evaluation into `PHASE_2`.

Dashboard: a compact **MT5 Demo** card (Equity/Balance/Free
Margin/Execution/Evaluation status/Current Risk) with a prominent
**DEMO ONLY** badge — rendered only when a connection row exists, so a
Replay/Paper-only user's dashboard is unaffected.

## Prisma (Fase 2, spec section 16)

New models, none storing a password/secret/token: `EvaluationAccount`
(singleton), `Mt5SymbolMapping`, `Mt5DemoPosition`. `ExecutionEvent`
gained `failedCheck` and `signalId` (both nullable, additive) and its
`status` comment was widened to document `FAILED_EXECUTION`/`SYNCHRONIZED`
as valid values alongside Phase 1's set — no existing column removed or
renamed.

## What is NOT built yet (deferred to later phases)

- **Correlation against MT5 positions** — `CORRELATION_OK` is a structural
  pass-through today (`correlatedOpenNotional` always 0): computing it
  would need bar history for arbitrary MT5 symbols, not fetched yet.
- **Exact contract-size-aware MT5 notional for exposure/concentration** —
  `mt5ExposureContext.ts` approximates notional as `volume * entryPrice`
  rather than `volume * contractSize * entryPrice`, to avoid an extra
  per-symbol spec lookup for every open position on every candidate; a
  real limitation for instruments with an unusual contract size.
- **News/economic calendar/weekend hooks** — no real provider exists; a
  future implementation must show "NOT AVAILABLE" honestly rather than
  fake a filter.
- **A tested connection to a real MT5 terminal** — see "Why MT5 can't be
  connected to for real, here" above; still true in Phase 2, unchanged.
- **A "Safety Switch requires an active evaluation" precondition** —
  `canEnableMt5Execution()` (Phase 1) still checks only
  connection/verifiedDemo/circuit-breakers; the evaluation-state gate is
  enforced at order time by the 15-point checklist
  (`EVALUATION_ACCOUNT_ACTIVE`/`NOT_FAILED`/`TARGET_NOT_REACHED`), not yet
  duplicated at the master switch.

## Tests

Phase 1 — `src/lib/execution/__tests__/mt5DemoExecutionAdapter.test.ts`
(28 tests, one updated for Fase 2's sanctioned integration point): demo
accepted, live rejected, missing account info rejected, disconnected
terminal, credentials never logged (including an adversarial error message
that contains the password), credentials never persisted, execution disabled
by default, Safety Switch preconditions (disconnected / not-demo / breaker
tripped / all clear), reconnection resets the switch, duplicate order
protection, AI cannot smuggle an approval through the eligibility check or
the order request, and a repo-grep proof that `HistoricalReplay` and the
pure paper-simulation internals never import `src/lib/execution/`, and that
`paperTradingEngine.ts`'s only door into it is `mt5ExecutionOrchestrator`.

Phase 2 (all against mocks — see "Why MT5 can't be connected to for real,
here"; no real MT5 terminal was ever reached from this environment):

- `evaluation/__tests__/evaluationRiskEngine.test.ts` (18) — profile
  templates, Phase 1/2 targets, daily safety/hard stop, total safety/hard
  stop, sticky terminal states, UTC day-key shifting.
- `evaluation/__tests__/evaluationAccountStore.test.ts` (15) — 20K/50K/
  100K/CUSTOM creation, day-reset across/within UTC days, TARGET_REACHED
  and FAILED persistence (exactly once), `advanceToPhase2` preconditions.
- `execution/__tests__/mt5PositionSizing.test.ts` (13) — correct risk,
  tickValue/tickSize sensitivity, volumeStep flooring, min/max volume,
  invalid metadata, invalid stop distance, risk never exceeds the approved
  ceiling.
- `execution/__tests__/mt5SymbolMapper.test.ts` (9) — exact match, broker
  suffix, distinct mappings, unmapped/disabled/broker-removed symbol.
- `execution/__tests__/mt5PositionSynchronizer.test.ts` (4) — open, update
  (never duplicates), close (removes stale cache), unknown ticket (never
  fabricated).
- `execution/__tests__/executionChecklist.test.ts` (22) — all-pass, each
  of the 16 individual checks rejecting on its own, first-failure-in-order
  priority, full audit trail even after an early failure.
- `execution/__tests__/mt5ExecutionOrchestrator.test.ts` (9) — full
  checklist-pass execution end to end, duplicate signal (exactly one
  adapter call), reconnection safety (terminal drop, no-longer-demo,
  Safety Switch never silently restored), LIVE-verified connection
  end-to-end rejection, FAILED-evaluation end-to-end rejection.
