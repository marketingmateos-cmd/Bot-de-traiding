# Crypto AI Trading Lab

A rigorous, self-skeptical research & **paper-trading** laboratory for crypto markets. The UI is
in Spanish; this document is in English for maintainers.

**This system never sends real orders.** Every position, every fill, every P&L number in this
app is simulated. The point of the lab is not "a bot that makes money" — it's a set of tools
that make it hard to fool yourself into thinking a strategy has an edge when it doesn't.

## Puesta en marcha rápida (en español)

Necesitas Node.js 20+ y una base de datos PostgreSQL accesible (local o en la nube — por ejemplo
un plan gratuito de [Neon](https://neon.tech) o [Supabase](https://supabase.com) si tu entorno no
trae Postgres instalado). Después:

```bash
npm install
npm run setup   # crea .env, intenta arrancar Postgres local, crea la BD, aplica el esquema y siembra datos de ejemplo
npm run dev     # arranca en el puerto 3000
```

Abre la URL que te indique tu entorno (en local: http://localhost:3000; en Codespaces/Gitpod/etc.,
la URL del puerto 3000 reenviado — suele aparecer en una pestaña "Ports" o en la barra de
direcciones al iniciar `npm run dev`). Si `npm run setup` no logra crear la base de datos
automáticamente (por ejemplo porque tu entorno no tiene Postgres instalado), edita `.env` y pon en
`DATABASE_URL` la cadena de conexión de una base de datos Postgres gratuita en la nube, luego
vuelve a ejecutar `npm run setup`.

**¿Cómo lo veo en el móvil?** La app es una PWA instalable. Si la ejecutas en un entorno con URL
pública (Codespaces, Gitpod, un despliegue en Vercel/Railway/etc.), abre esa misma URL desde el
navegador de tu móvil y usa "Añadir a pantalla de inicio" (Chrome/Android) o "Compartir → Añadir a
pantalla de inicio" (Safari/iOS) para que se comporte como una app nativa. Si solo la ejecutas en
`localhost` de tu ordenador, tu móvil no podrá acceder a menos que ambos estén en la misma red y
uses la IP local del ordenador, o que despliegues la app en un servicio como Vercel para tener una
URL pública permanente.

## Running it (English)

```bash
cp .env.example .env        # already done in this repo; edit if you have real DATABASE_URL/keys
npm install
npm run setup                # or: npm run db:push && npm run db:seed
npm run dev                 # http://localhost:3000
```

Runs with **zero external API keys**. Market data, news, sentiment, and on-chain metrics come
from deterministic synthetic providers (clearly labeled `DEMO MODE` throughout the UI) unless
you point the corresponding `*_PROVIDER` env var at a real one and implement it. Set
`ANTHROPIC_API_KEY` to switch the AI Analyst/Critic layer from a rule-based demo to real Claude
calls — everything downstream (Trade Gate, Journal, UI) is unaffected either way, since both
implementations satisfy the same `AIProvider` interface.

Tests (unit + a Postgres-backed integration suite against an isolated `*_test` database):

```bash
createdb crypto_ai_trading_lab_test        # once
DATABASE_URL=postgresql://...test npx prisma db push
npm test
```

## Why the stack differs slightly from the brief

The brief asked for Next.js/React/TypeScript/Tailwind/Postgres/Prisma — that's what's here, with
two deliberate substitutions:

- **Next.js 15.5.25, not the 16.x that `create-next-app` offered.** 16 was released very recently
  and its own generated docs open with "this is NOT the Next.js you know." For an app this large,
  the risk of subtle breaking-change bugs across 40+ routes outweighed being on the latest major.
  15.5.25 (patched — the initial 15.5.4 scaffold had a since-fixed critical RCE advisory) is
  stable and well-documented.
- **Tailwind 3, not 4.** Same reasoning — 4's CSS-first config is still settling; 3's
  `tailwind.config.ts` is what most Tailwind knowledge (including this codebase's) assumes.

Everything else — Prisma 5 + PostgreSQL, `recharts`/`lightweight-charts` for charts, `zustand`
for any client state, `@anthropic-ai/sdk` for the AI layer, `vitest` for tests — matches the
brief directly.

## Architecture

```
MarketDataProvider ─┐
NewsProvider ────────┼─► Data Quality Engine ─► Feature Engine ─► Market Regime Engine ─┐
SentimentProvider ───┤                                                                   │
OnChainProvider ─────┘                                                                   ▼
                                                                          Market Intelligence Score
                                                                                          │
                                                                                          ▼
                                                                                 Strategy Engine
                                                                                          │
                                                                                          ▼
                                                                              AI Analyst ─► AI Critic
                                                                                          │
                                                                                          ▼
                                                                                     Trade Gate
                                                                        (11 checks; APPROVED / LOW_CONFIDENCE / BLOCKED)
                                                                                          │
                                                                        ┌─────────────────┼─────────────────┐
                                                                        ▼                 ▼                 ▼
                                                                  Risk Engine   Circuit Breakers   Position State Manager
                                                                                                              │
                                                                                                              ▼
                                                                                              Paper Execution Engine (fees/slippage/fills)
                                                                                                              │
                                                                                                              ▼
                                                                                       Trade Journal ─► Post-Mortem ─► Learning Loop
```

Everything left of the Trade Gate is read-only analysis. **Nothing downstream of the Trade Gate
executes unless it explicitly returns `APPROVED`** (or, at reduced size, `LOW_CONFIDENCE` — see
below); a `BLOCKED` verdict never trades, whatever the strategy or the AI thinks. This is the
literal implementation of spec principle #53, "RULES + DATA + RISK + AI, not AI → TRADE."

### Provider abstraction (`src/lib/providers/`)

`MarketDataProvider`, `NewsProvider`, `SentimentProvider`, `OnChainProvider`, `AIProvider` are
interfaces (`types.ts`); `registry.ts` is the one place that decides which concrete
implementation backs each one, based on env config. Every engine and every page depends only on
the interface. Adding a real provider later — CoinGecko, a news API, a real on-chain indexer — is
a new class implementing the interface plus one line in the registry; nothing else changes.

### Autonomous bot loop (`src/lib/botLoop.ts`, V3)

The app no longer waits for a manual "scan" click. `src/instrumentation.ts` starts a self-scheduling
loop once when the Node server boots (`register()` — [Next's instrumentation
hook](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation)); every
`BotConfig.intervalSeconds` (default 60s, editable in the `BotConfig` row) it:

1. Always ticks open positions (`positionLifecycle.tickPositions`) — mark-to-market P&L and
   stop/take-profit closes happen even while the bot is paused, since managing risk on positions
   already opened isn't "the bot deciding to trade."
2. If `BotConfig.isActive` is `true` and nothing is blocking (trading not blocked, no tripped
   circuit breaker): runs the full scan (`paperTradingEngine.runPaperTradingScan`) and opens a
   paper position on an `APPROVED`/`LOW_CONFIDENCE` verdict. Finding nothing worth trading is a
   valid, logged outcome (`WAITING`), not a failure — it never forces a trade to look busy.

`BOT ON/OFF` is a plain boolean on `BotConfig`, flipped from Settings or the Dashboard's status
card (`POST /api/bot/toggle`); `GET /api/bot/status` is what the Dashboard polls for the live
status badge/countdown, alongside a separate **Worker** badge (`computeWorkerHealth` in
`BotStatusCard.tsx`) — HEALTHY/STALLED/UNKNOWN based on how stale `BotConfig.lastRunAt` is versus
the configured interval. This is a deliberately distinct signal from the bot's ACTIVE/PAUSED
trading intent: it answers "is the persistent process's loop still actually heartbeating at all",
which matters most right after closing the desktop window (see below).

**This only runs continuously on a persistent Node process** — the Electron desktop app and a
Render/Railway deploy both qualify (recommended path for 24/7 unattended operation). A serverless
deploy (Vercel) tears down the process between requests, so `setTimeout` can't survive there; that
path would need a real external cron hitting an API route instead, which isn't wired up since the
desktop app is the primary target. `runPaperTradingScan` itself is also safe against overlapping
calls on the same account (an in-memory in-flight map in `paperTradingEngine.ts` — a manual scan
and the autonomous loop firing at the same moment join the same result instead of racing).

**Bot 24/7 — closing the desktop window doesn't stop an active bot** (`electron/main.js`,
`electron/serverLifecycle.js`): the Next.js server (and its self-scheduling loop) is a separate
child process from the window — closing the window was never actually *required* to kill it, but
before this fix `window-all-closed` called `app.quit()` unconditionally on Windows/Linux, which
did. Now, on window close, the app asks the running server whether the bot is currently active
(`GET /api/bot/status`); if so, it hides into a system tray icon instead of quitting — the server
process, and therefore the loop, keeps running exactly as it does with the window open. The tray's
"Salir" item (or quitting an inactive bot normally) is what actually stops it. Reopening the window
later (from the tray, or the dock on macOS) never spawns a second server: `isServerRunning` in
`serverLifecycle.js` checks the existing child process is still alive first (this is also what
fixed a pre-existing macOS `activate` bug that used to spawn a duplicate server on every dock
re-click). Safe restart: if the server process ever does die (crash, force-kill, OS restart),
the next window open runs the same startup path as a first launch — migration, then server spawn
— against the same on-disk database, so no state is lost and no manual recovery step is needed.

The `1-10` risk slider (`resolveRiskLimitsForLevel` in `riskEngine.ts`) is the real input to
position sizing, max exposure, max open positions, and the daily-loss/drawdown circuit breakers —
not a cosmetic label. Changing it only affects the *next* trade the bot opens; positions already
open keep the size they were opened with.

### Engines (`src/lib/engines/`)

Each spec module maps to one file: `dataQuality.ts`, `features.ts` (indicators), `regime.ts`,
`marketIntelligence.ts`, `news.ts`, `sentiment.ts`, `strategy/*` (7 strategies + registry),
`riskEngine.ts`, `paperExecution.ts`, `positionStateManager.ts`, `positionLifecycle.ts`
(stop/target ticking + mark-to-market), `tradeGate.ts`, `circuitBreakers.ts`, `backtest.ts`,
`walkForward.ts`, `monteCarlo.ts`, `robustness.ts`, `overfitting.ts`, `benchmark.ts`,
`hypothesis.ts`, `postMortem.ts`, `luckVsEdge.ts`, `strategyLeague.ts`, `anomalyDetector.ts`,
`aiBudget.ts`, `auditLog.ts`, `alerts.ts`, `dailyProfitProtection.ts` (Fase 6, below), and
`src/lib/replay/*` (Fase 7-8's Historical Replay engine, below — a separate module tree, not
under `engines/`, since it composes these engines rather than being one itself). All are plain,
mostly-pure TypeScript — no framework coupling — which is what makes the Vitest suite possible
without mocking half the app.

### The Trade Gate (`tradeGate.ts`)

Runs **all 12 checks every time**, never short-circuiting, so the UI can always show the full
audit trail (see the Paper Trading screen: every blocked/low-confidence candidate shows exactly
which check stopped it and why). A failed non-downgrade check → `BLOCKED`. A downgrade-only issue
(sentiment/price divergence, missing on-chain data, thin evidence) → `LOW_CONFIDENCE`, which the
Paper Trading Engine executes at **half size**, never full size — enough to keep accumulating the
real trade history that Robustness/Luck-vs-Edge need, without betting the account on a hypothesis
the system itself isn't confident in. The 12th check, `DAILY_PROFIT_PROTECTION` (Fase 6, below),
is derived from the other 11's own intermediate verdict rather than looking at its own raw inputs,
so it never short-circuits ahead of them either.

### Reproducibility (spec #54)

Every `PaperPosition` stores a `snapshot` JSON blob captured at entry: the indicator values,
regime, top news, sentiment, on-chain reads, and the full AI Analyst + Critic output. Every
closed `Trade` carries this into its `TradeJournal`. Nothing about "why did the system do this"
is ever reconstructed after the fact from logs — it's stored at decision time.

### Position State Manager (spec #19)

`positionStateManager.ts` is the only code path allowed to create/transition/close a
`PaperPosition`. State transitions are a hard-coded machine (`FLAT → PENDING → OPEN →
{PARTIALLY_CLOSED, CLOSED, ERROR}`); illegal transitions throw `InvalidTransitionError`. Opening
a position is one Prisma transaction (order + fill + position row), so it's structurally
impossible to end up with a filled order and no position, or vice versa. `reconcilePositions()`
scans for duplicate open positions / orphaned filled orders and, if it finds any, **blocks the
account from new trades** (`PaperAccount.isTradingBlocked`) until a human clears it from the Risk
Center — matching spec principle #65 ("detect an inconsistency → stop new trades, don't guess").

### Circuit breakers (spec #22)

Six independent breakers (max daily loss, max drawdown, max trades/day, data corruption, API
down, position inconsistency) live in the `CircuitBreaker` table and are evaluated on every scan.
A tripped breaker blocks **all** new paper trades regardless of what the Trade Gate says. Loss/
drawdown breakers require a manual reset (Risk Center or Settings); transient ones (API health,
data quality, reconciliation) auto-clear once the underlying condition resolves. **Fase 5 — "Max
Trades" is no longer the primary risk firewall**: trade *count* was never a real proxy for risk,
so `MAX_TRADES` was demoted to a pure technical safety ceiling (a runaway-loop guard, raised from
25 to 300/day) rather than a trading rule. The real controls are capital-at-risk based: per-trade
risk sizing, aggregate exposure, per-asset **concentration**, and — new in Fase 5 — **correlation**
(`riskEngine.ts`'s `correlation()`), which sums the notional of *other* open positions whose recent
bar-close returns move with the candidate above a `0.7` threshold. This exists because several
different-but-correlated assets (e.g. BTC and ETH moving together) can quietly recreate the exact
concentrated bet the same-asset concentration check alone can't see, since each individually looks
like an unrelated position.

### Daily Profit Protection (Fase 6) — `dailyProfitProtection.ts`

A state machine — `NORMAL` / `PROFIT_PROTECTION` / `HARD_DAILY_STOP` — driven **only** by the
account's own real, measured numbers: today's realized P&L (closed trades) plus unrealized P&L
(open positions, from the last mark-to-market) against the account's own equity at the start of
today (UTC). Never an AI opinion, and never hardcoded — every threshold lives in the persistent,
Settings-editable `ProfitProtectionConfig` row (defaults: protect gains at `+3%`, hard-stop losses
at `-5%`).

- **`NORMAL`** — no restriction; the Trade Gate's 12th check passes unconditionally.
- **`PROFIT_PROTECTION`** (today's gain ≥ the trigger) — every new candidate is **blocked** unless
  it clears a purely quantitative "exceptional opportunity" bar
  (`checkExceptionalOpportunity`): the Trade Gate's other 11 checks must already resolve to a clean
  `APPROVED` (no downgrade anywhere else), the AI Analyst must recommend `APPROVE` above a
  configured confidence floor, the AI Critic must return `APPROVED`, **and** the strategy version
  must have a genuine, verified track record (`luckVsEdge.ts`'s evidence level at or above the
  configured minimum — `MEDIUM` by default, meaning 30+ real closed trades). All of these must hold
  at once; none of them alone — including a high AI confidence number — is ever sufficient by
  itself. This is deliberate: the spec explicitly forbids letting "the AI says it's good" be the
  exception on its own. A trade that does clear the bar still executes at a reduced size
  (`exceptionalSizeMultiplier`, default `0.5`) — protecting the day's gains never fully disappears
  even for a verified exception.
- **`HARD_DAILY_STOP`** (today's loss ≤ the hard floor) — **no exception exists for this state**:
  the scan returns before evaluating any candidate at all (no AI budget spent), full stop on new
  risk for the rest of the day.

In every state, **open positions are still managed** — `positionLifecycle.tickPositions` (stops,
targets, mark-to-market) runs independently of and prior to the scan in `botLoop.ts`, so Daily
Profit Protection blocking *new* trades never means abandoning risk management on what's already
open. Every state transition (not every scan cycle — that would spam duplicate alerts every
~60s) logs a `SystemAlert` and an audit log entry with the real numbers behind it, and both the
Dashboard and Settings pages surface the live state, today's P&L%, and the human-readable reason
(`computeProfitProtectionStatus`). Configuration (trigger/floor thresholds, the exceptional-opportunity
criteria, and the reduced size) is edited from Settings and takes effect on the next scan.

### No look-ahead, ever (spec #23)

`backtest.ts` evaluates a strategy against `bars[0..i]` only, and a signal generated from bar
`i`'s close fills at bar `i+1`'s **open** — never at its own close. This is enforced structurally
(the strategy function is only ever handed a truncated array), not by convention, and is covered
by a dedicated regression test (`backtest.test.ts`) that fails if the window ever grows
out of order or a fill uses same-bar data.

### Historical Replay (Fase 7-8) — `src/lib/replay/`

A second, structurally separate simulation engine from `backtest.ts` above: instead of a
strategy-only loop, it drives the **full** live pipeline (strategy → data quality → regime → AI
Analyst → AI Critic → Trade Gate → Risk Engine → circuit breakers → execution) chronologically
over historical bars, so it answers "how would the actual bot have decided", not just "would this
signal have been profitable". `/replay` (Research → Historical Replay in the nav) is the UI; `POST
/api/replay/run` + `GET /api/replay/[id]` persist runs to their own `ReplayRun`/`ReplayResult`
tables.

- **Isolation (REGLA ABSOLUTA #7)**: `ReplayPortfolio` is a plain in-memory object with no
  `@/lib/db` import anywhere in it — a replay run never reads or writes
  `PaperAccount`/`PaperPosition`/`PaperOrder`/`Trade`/`BotConfig`. Verified by dedicated tests
  (`historicalReplayEngine.test.ts`, `benchmarkAndIsolation.test.ts`) that assert those tables'
  row counts are unchanged after a run.
- **Zero look-ahead, structurally**: `ReplayClock` only ever moves forward one tick at a time, and
  `barsAsOf(bars, tickMs)` — the single chokepoint every strategy/indicator/regime/AI/Trade
  Gate/Risk/execution call goes through — truncates every asset's series to "at or before the
  current tick", exactly mirroring `backtest.ts`'s own `bars[0..i]` discipline but generalized to
  multiple assets and the full pipeline.
- **Data Quality gate (Fase 7C)**: `evaluateHistoricalDataQuality` checks coverage, gaps,
  duplicate timestamps, chronology violations, invalid OHLCV, and future-date leakage over the
  *whole* requested range before a replay is allowed to run at all — a replay with < 50% coverage,
  any future leakage, or an out-of-order timestamp is refused, not silently degraded.
- **IS / VALIDATION / OOS (Fase 7D)**: `runIsValidationOosReplay` runs three **fully independent**
  replays (their own portfolio, equity curve, trade list) over the same underlying bars — never
  one combined curve. Nothing in this codebase has a parameter optimizer that could act on OOS
  results even if the three were mixed, so "never tune on OOS" holds structurally, not just by
  UI convention.
- **Walk-Forward (Fase 7E)**: `runReplayWalkForward` slides a train/test window across the full
  range, running the *full pipeline* replay (not just `runBacktest`) for both halves of every
  window. Its output is the exact same `WalkForwardResult` shape the existing (Fase 4)
  `computeRobustnessScore`/`detectOverfitting` already consume — `ReplayMetrics` is a structural
  superset of `BacktestMetrics`, so those two engines needed zero changes to accept it.
- **Three AI modes (Fase 7B)**, chosen per run: `FULL_HISTORICAL` only ever uses a REAL
  `AIAnalysis` row the live system already wrote near that exact historical timestamp — if none
  exists (the overwhelming majority of the time, since this environment has no real historical
  news/sentiment/on-chain archive either) the candidate is marked `SKIPPED_NO_HISTORICAL_DATA`,
  never fabricated. `DETERMINISTIC_AI` always calls the rule-based `DemoAIProvider` — a pure
  function of its input, reproducible, explicitly tagged `DETERMINISTIC_SYNTHETIC` (never presented
  as a real historical conversation). `AI_ASSISTED` calls whatever AI provider is live-configured
  during the replay itself, tagged `EXPERIMENTAL_LIVE`, capped at 200 calls/run as a safety
  ceiling (mirrors `circuitBreakers.ts`'s own MAX_TRADES philosophy — a technical guard, not a
  trading rule).
- **Robustness & Overfitting (Fase 7G/7H)**: `runReplayRobustnessAnalysis` re-runs the same config
  under parameter jitter, elevated fees/slippage, and (optionally) other assets, then feeds those
  returns — plus the run's own walk-forward as "different periods" — into the unmodified Fase 4
  `computeRobustnessScore`. Its `ROBUST`/`MODERATE`/`FRAGILE`/`INSUFFICIENT_DATA` classification
  explicitly refuses `ROBUST` below 30 trades and an executed walk-forward, no matter the score.
  `detectReplayOverfitting` delegates straight to the existing `detectOverfitting`.
- **Evidence Quality (Fase 8)**: `computeEvidenceQuality` takes **no profitability figure as
  input at all** — sample size, data coverage, OOS presence/size, robustness classification, and
  overfitting risk decide `INSUFFICIENT_EVIDENCE`/`LOW`/`MEDIUM`/`HIGH`, so a good-looking return
  on a thin, un-validated sample can never read as strong evidence.
- **"WHY DID THE BOT ENTER?"**: every decision the engine records (only when a strategy actually
  produced a signal — not every silent bar, to keep a months-long replay's log a sane size) carries
  the full chain — market/regime, strategy signal, AI Analyst/Critic output, Trade Gate steps,
  Risk Engine result, sizing, and a plain-language reason — plus a per-source `availability` tag
  (`SYNTHETIC`/`REAL`/`UNAVAILABLE` for market/news/sentiment/on-chain,
  `REAL_HISTORICAL`/`DETERMINISTIC_SYNTHETIC`/`EXPERIMENTAL_LIVE`/`UNAVAILABLE` for AI) so the UI
  never has to guess what actually backed a given decision.

**Honest finding from building this**: running a real replay surfaced that most of the 7 built-in
strategies' own `defaultStopLossPct` (2-4%) combined with `calculatePositionSize`'s risk-based
sizing make a single, brand-new position's notional exceed `maxConcentrationPct` at most risk
levels 1-10 — meaning several (strategy, risk level) combinations can structurally never open a
first trade, in replay **or in live paper trading**, since both share the exact same
`calculatePositionSize`/`checkExposureLimits` functions. This isn't a replay bug (a replay at
`riskLevel: 1` with `trend-following` over 6 months of synthetic BTC data opens 735 real trades
end to end, confirming the pipeline itself works) — it's a pre-existing calibration mismatch
between strategy defaults and the risk-level anchor table from earlier phases, which Fase 7 simply
made visible by actually trying to trade for months at a time instead of one scan at a time. Not
fixed here (would mean changing Risk Engine/strategy defaults, out of this phase's "no tocar"
scope) — flagged for a deliberate follow-up decision.

### Strategy Lab — Strategy Research & Evaluation Benchmark (Fase 11) — `src/lib/research/`

Compares four **baseline** strategy families (Breakout, Momentum, Mean Reversion, Trend Following —
`src/lib/engines/strategy/baseline/`) under IDENTICAL dataset/Risk Engine/Evaluation Profile
conditions, to see which families show promising signals — never to declare a winner or tune
parameters. `/strategy-lab` (Backtest → Strategy Lab) is the UI; `POST /api/strategy-benchmark` +
`GET /api/strategy-benchmark/[id]` persist to `StrategyBenchmarkRun`/`StrategyBenchmarkResult`.

- **Never duplicates the replay engine**: `runStrategyBenchmark()` calls the SAME
  `executeReplay()` every Historical Replay run uses, once per baseline strategy with an
  otherwise-identical `ReplayConfig` (`aiMode: DETERMINISTIC_AI` for reproducibility,
  `dataSource: HISTORICAL_REAL` from the UI). Each strategy's trade simulation is a completely
  normal `ReplayRun`/`ReplayResult` row — `StrategyBenchmarkResult` only adds the Evaluation Risk
  Engine analysis and a composite score on top.
- **Baseline strategies are simple and NOT optimized**: explicit, reasonable constants (e.g.
  breakout `lookback:20, atrMultiplier:1.5, rrr:1.5`) — no grid search, no parameter fitting to this
  dataset. Stop-loss is volatility-based (ATR over the strategy's own configured period, computed
  only from bars at or before the current one); take-profit is `stopDistance × rrr`. A new,
  additive `StrategySignal.stopLossPrice`/`takeProfitPrice` lets a strategy override
  `historicalReplayEngine.ts`'s default fixed-% stop/target — every pre-existing strategy leaves
  these unset and is unaffected.
- **Evaluation Risk Engine reused, not duplicated**: `evaluateBenchmarkRun()` walks a completed
  replay's own equity curve chronologically through the SAME `evaluateEvaluationAccount()` the live
  MT5 pipeline uses (Fase MT5.2), to classify the single historical trajectory as `PASS` (target
  reached before any hard failure), `FAIL` (an actual daily/total hard-stop breach), or
  `INCONCLUSIVE` (neither, never mislabeled `FAIL` just for running out of time) — spec section 16:
  this produces one Historical Outcome, never a "Probability of Passing" from a single path.
- **Composite Score is a ranking aid only**: 30% profitability (return capped at 20%) + 30%
  drawdown + 20% consistency (win rate + profit factor) + 20% evaluation survival — documented in
  `benchmarkScore.ts` and shown in the UI, explicitly never used to pick parameters.
- **Reproducibility**: `computeStrategyConfigHash()` hashes strategy id + version + exact params;
  the exact same request run twice produces byte-identical persisted metrics (tested).
- **Real result from BTC H1, 2026-03-01 → 2026-08-31 (`binance_csv`, 4,416 real candles)**: none of
  the four families reached the +10% Phase 1 target. Momentum (-4.6%) and Breakout (-8.1%) ended
  `INCONCLUSIVE`; Mean Reversion (-17.0%) and Trend Following (-21.9%) both `FAIL`ed a total hard
  stop before the period ended. **This is not evidence that any family lacks edge in general** —
  it's one six-month trajectory for four intentionally un-optimized baselines; see the Strategy Lab
  UI's own on-screen disclaimer.

### Regime-Aware Strategy Research (Fase 12) — `src/lib/research/regimeAnalysis.ts`

Given Fase 11's result — none of the four baseline families showed a demonstrated edge — Fase 12
asks a narrower question: **does performance depend strongly on market regime?** Pure
post-processing over trades a benchmark run ALREADY simulated; never a second Regime Engine, never
a re-run of the replay, never a parameter change. `GET /api/strategy-benchmark/[id]/regime-analysis`
computes it on demand; `POST .../stability-check` reuses the existing IS/VALIDATION/OOS replay
infrastructure (opt-in, per strategy) to see whether a regime's pattern repeats across segments.
The `/strategy-lab` UI shows both per strategy, below the existing Fase 11 detail view.

- **No future leakage, by construction, not by care**: every `ReplayTradeRecord` carries
  `decisionIndex`, pointing at the EXACT `ReplayDecisionRecord` that opened it — same tick, same
  `detectRegime()` call, same causal `barsAsOf` window the live pipeline already used. Joining
  through that index is "regime at signal/entry time" structurally; there is no code path that
  could attach a later regime to an earlier trade (tested explicitly, including with shuffled
  timestamps and an out-of-range index).
- **Volatility bucket is a new, additive axis**: the Regime Engine's own `HIGH_VOLATILITY`/
  `LOW_VOLATILITY` values are rare, tail-only regimes, mutually exclusive with every trend/range
  regime — not what "how volatile was this trade's environment" actually needs. `detectRegime()`
  already computed a continuous `volatilityPercentile` and discarded it; Fase 12's only change to
  `historicalReplayEngine.ts` persists that existing value onto `ReplayDecisionRecord`, and
  `computeVolatilityBucket()` derives a documented tercile (`LOW`/`NORMAL`/`HIGH`, <25th/25-75th/
  >75th percentile) from it — a genuinely new, clearly-labeled classification, not a
  reinterpretation of the engine's own regimes.
- **Statistical caution is one shared constant**: `MIN_SAMPLE_SIZE = 20` applied uniformly to
  every grouping (regime, direction, volatility, hour, weekday, matrix cell). A thin cell's real
  numbers are always still computed and returned — never hidden — but flagged
  `insufficientSample: true`, and the UI visibly dims/labels those cells rather than presenting
  them as equally solid.
- **R-multiple, loss, and exit analysis** — `netPnl / (|entryPrice − stopLoss| × quantity)` per
  trade (Fase 11 already captures `stopLoss` on every trade), the 10 largest losses, a
  losing-streak length histogram, and exit-reason breakdown cross-tabbed by regime — to separate
  "the strategy has no edge" from "the strategy has an edge but an unfavorable trade distribution."
- **Strategy × Regime matrix**: one row per (strategy, observed regime), trades/PF/expectancy/
  P&L, `insufficientSample` never dropped.
- **No AI, no optimization anywhere in this module**: every number above comes from
  `regimeAnalysis.ts`'s deterministic functions; the AI Analyst/Critic layer is untouched and has
  no path to choose a regime, drop a trade, or influence these stats. Baseline strategies, stop-
  loss/take-profit logic, and the Risk Engine are all byte-for-byte unchanged from Fase 11 —
  re-running the exact same benchmark after this phase's changes reproduces IDENTICAL trade counts
  and P&L per strategy (235/184/365/643 trades, confirmed).
- **Real result from the same BTC H1 2026-03-01→2026-08-31 run**: `RANGE` is the dominant regime
  by trade count for all four strategies and consistently unprofitable (PF 0.34-0.71 with
  sufficient samples for every strategy). `LOW_VOLATILITY` is the worst regime for Mean Reversion
  (PF 0.14, expectancy −7.78€) and Trend Following (PF 0.27, expectancy −7.10€), both with
  sufficient samples. `HIGH_VOLATILITY` is the *least* unprofitable regime for three of four
  strategies (PF 0.82-0.95) despite still not reaching 1.0. `BEAR` is the only regime near or
  above breakeven with a reasonable sample (Trend Following: 28 trades, PF 1.03, expectancy
  +0.36€); Momentum's BEAR cell looks better still (PF 1.19, +1.71€) but at only 13 trades is
  flagged `INSUFFICIENT_SAMPLE` — a hypothesis to investigate further, not a conclusion. Every
  single strategy's single largest loss happened in the same `HIGH_VOLATILITY` window
  (2026-06-03 to 06-07), all via `STOP_LOSS` — a real, striking cross-strategy correlation, not
  four independent worst trades. R-multiple distributions (median ≈ −1.1 to −1.2R, close to the
  mean) show the negative expectancy is broad-based rather than driven by a few catastrophic
  outliers. **None of this identifies an edge** — it identifies which regime/volatility
  combinations are worth investigating further, and which (e.g. any BULL cell, most BEAR cells)
  don't yet have enough trades to say anything.

### Hypothesis Validation & Walk-Forward (Fase 13) — `src/lib/research/hypothesisValidation.ts`

Fase 12 produced hypotheses (H1-H5), not conclusions. Fase 13 asks the follow-up question directly:
**do those patterns still hold outside the segment where they were first observed?** Still pure
post-processing/re-simulation with the SAME baseline config — no parameter ever changes.
`POST /api/strategy-benchmark/[id]/hypothesis-validation` (+ its `.../walk-forward` sub-route) power
a new "Hypothesis Validation" section in `/strategy-lab`.

- **One real IS/VALIDATION/OOS split, not fabricated multiple windows**: the same 60/20/20
  chronological split Fase 12's stability-check already used. A supplementary walk-forward check
  (reusing the unmodified Fase 7E engine) DOES produce 3 sliding windows over the 184-day range,
  but deliberately stays at the aggregate return/PF level — decomposing each window's already-small
  OOS portion (~27 days) by regime would push most cells below `MIN_SAMPLE_SIZE`, so it isn't done
  (documented explicitly in `WALK_FORWARD_LIMITATION_NOTE` rather than fabricating false precision).
- **OOS shown first, everywhere** (UI columns and internal segment ordering) — the explicit point is
  to stop a reader from anchoring on the training segment.
- **A hypothesis "direction" reduces to one comparison**: does the subgroup's (e.g. RANGE trades)
  expectancy sit on the hypothesized side of its complement's? Evaluable only when the subgroup
  itself clears `MIN_SAMPLE_SIZE` — never coerces a verdict from a handful of trades.
- **Four-way descriptive verdict, never PASS/FAIL**: `SUPPORTED` (every evaluable segment agrees,
  including OOS, across ≥2 segments), `WEAK` (mixed, or only one segment evaluable), `REJECTED`
  (every evaluable segment disagrees), `INCONCLUSIVE` (nothing evaluable anywhere) — formula and
  reasoning documented in `STABILITY_SCORE_FORMULA`.
- **Real result** (same BTC H1 2026-03-01→2026-08-31 run): of the 10 H1/H2/H3/H4 checks (4
  strategies × RANGE + HIGH_VOLATILITY, plus Trend Following/Momentum × BEAR), **none reached
  `SUPPORTED`** — RANGE was `REJECTED` for Momentum and Trend Following (the direction reversed
  out-of-sample) and only `WEAK` for Breakout/Mean Reversion; every HIGH_VOLATILITY and BEAR check
  landed `WEAK` or `INCONCLUSIVE` because OOS/VALIDATION samples were too thin to evaluate. H5 (the
  2026-06-03/07 loss cluster) classified `MIXED`: widening the lens from "each strategy's single
  worst trade" to "every trade overlapping that week" shows Momentum and Trend Following actually
  finished the window positive — the original "common market event" reading doesn't survive contact
  with the full data. The supplementary walk-forward's 3 windows were unanimously negative-OOS-return
  for every strategy (0% window win rate across the board) — consistent with Fase 11/12's "no
  demonstrated edge" finding, this time checked outside a single split.

### Research Dataset Versioning (Fase 14) — `src/lib/research/researchDataset.ts`, `/datasets`

Fase 13 ended on "the four baselines show no demonstrated edge, and the main bottleneck is dataset
depth." Fase 14's job was to grow the real BTCUSDT H1 history past 2026-03-01→08-31 — and to build
the versioning/reproducibility layer any larger dataset would need. **Only the second half
happened.** This environment's network policy blocks every crypto-data host tried
(`api.binance.com`, `data.binance.vision`, `api.coingecko.com`, `www.cryptodatadownload.com` — all
returned a `403` CONNECT-tunnel policy denial from the egress proxy, confirmed live, not assumed
from the README's own earlier note), and no additional real CSV exists on disk beyond the same six
monthly zips Fase 9.1 already imported. Per spec section 16's own explicit instruction for exactly
this situation ("si no es posible obtener varios años... no rellenar... indicar exactamente qué
período real se consiguió"): **the real historical period stays 2026-03-01→08-31, 4,416 H1
candles — nothing invented, nothing backfilled.**

- **`ResearchDataset`**: a new Prisma model — never a second copy of `MarketData`. Registering one
  re-validates a (symbol, timeframe, source) slice of ALREADY-imported candles fresh (ascending
  timestamps, no duplicates, valid OHLC/volume via the same `validateCandleBatch` the importer
  itself uses, H1-aligned intervals, nothing past the requested end) and computes a SHA-256
  `datasetHash` over `timestamp|open|high|low|close|volume` per row in chronological order.
  Idempotent: registering the identical range twice returns the same row (`@@unique` constraint),
  and re-registering after nothing changed reproduces the identical hash (tested).
- **Reused, not duplicated**: `computeMarketDataCoverage` (Fase 9.6) gained one additive optional
  `range` parameter for gap/coverage math scoped to an arbitrary sub-range — every existing caller
  omitting it is unaffected. `validateCandleBatch` (Fase 9) runs unmodified as the OHLC/volume gate.
- **Reproducibility wired through, not just bolted on**: `ReplayConfig.datasetId` (optional) →
  `executeReplay()` copies the dataset's OWN hash onto the `ReplayRun` row at run time (never just a
  join) → `runStrategyBenchmark()` propagates the same id into every strategy's `ReplayConfig` and
  stamps its own `StrategyBenchmarkRun` row too. Verified end-to-end: selecting the registered
  dataset in `/strategy-lab` and running Momentum produced a `StrategyBenchmarkRun` and its
  underlying `ReplayRun` both carrying the identical `datasetId`/`datasetHash`.
- **`/datasets`**: register (symbol/timeframe/dates/source) and list every registered dataset with
  all spec-required fields, plus a manifest viewer (`GET /api/datasets/[id]`) — the frozen,
  self-describing snapshot spec section 7 asks for, never re-derived from `MarketData` at read time.
- **Scope honestly**: Historical Replay's own separate form (`/replay`) was not given a dataset
  picker — only Strategy Lab was, since that's the pipeline Fases 11-13 actually exercise. The API
  layer (`ReplayConfig.datasetId`) already accepts one regardless.
- **What did NOT happen, on purpose**: no baseline re-run on an "expanded" dataset (section 12-13 —
  there is no expanded dataset to compare against), no new temporal-stability or regime-comparison
  pass (section 14-15 — same reason). Re-running the exact same 6-month dataset now goes through the
  new `datasetId` machinery and reproduces byte-identical trade counts, confirming the wiring itself
  is correct — that is NOT the same claim as "the dataset grew," and this README does not conflate
  the two.

### Replay & Execution Integrity Audit (Fase 15) — `src/lib/replay/pnlReferenceModel.ts`

Before trusting Fase 11-14's negative results, Fase 15 audited whether `HistoricalReplayEngine`
actually simulates what it claims to: DATA → SIGNAL → RISK → SIZE → ENTRY → SL/TP → EXIT → P&L →
EQUITY → DAILY/TOTAL LOSS → EVALUATION. **Conclusion: no material execution integrity bugs found.**
36 new targeted tests (`src/lib/replay/__tests__/executionIntegrityAudit.test.ts`) all passed on
first write, on top of the pre-existing, already-thorough `riskEngine.test.ts`,
`evaluationRiskEngine.test.ts`, `paperExecution.test.ts`, and — crucially — `pnlMath.audit.test.ts`
from an earlier dedicated P&L audit (Fase 1.A2) this phase deliberately did not re-litigate.

- **Same-candle SL/TP policy, now explicit**: when one H1 candle's high/low would satisfy BOTH the
  stop and the target, `checkStopsAndTargets` (`paperExecution.ts`) ALWAYS resolves it as
  `STOP_LOSS` — the stop branch is checked and returned first, unconditionally, regardless of how
  far each level was breached. This was already the code's real behavior; it just wasn't stated
  anywhere as a deliberate policy before. A genuine intrabar TP-vs-SL order can't be recovered from
  OHLC alone, so this is the honest, pessimistic, order-blind choice — not changed, only documented
  and tested (both LONG and SHORT).
- **Fee convention, verified against the account ledger, not just re-asserted**: entry fee and exit
  fee are each charged exactly once — entry fee debited from `ReplayPortfolio.cashBalance`
  immediately at open, exit fee subtracted inside `trade.netPnl` at close. `ReplayTradeRecord.netPnl`
  itself reflects `grossPnl − exitFee` only (by design, matching the SAME convention already audited
  and tested in `pnlMath.audit.test.ts` for live paper trading, and present in `backtest.ts` too) —
  the account's real total return DOES include both fees, reconciled exactly in the new audit tests.
  This is a documented accounting convention, not a bug: changing what three independently-audited,
  mutually-consistent engines already agree on was explicitly out of scope (spec section 23).
- **`calculateReferencePnL()`**: a genuinely independent P&L function (imports nothing from
  `replayPortfolio.ts`/`positionStateManager.ts`) validated against real `simulateFill()` output for
  LONG/SHORT winners and losers, plus an R-multiple cross-check proving the metric is invariant to
  Trade Gate size reduction.
- **Position sizing across Risk Level 1/5/10**: `approvedNotional ≤ requestedNotional` and realized
  $ risk ≤ configured risk hold at every level, tested explicitly (not just inferred from the
  existing monotonicity tests).
- **Exposure freshness**: `ReplayPortfolio.openNotional()`/`assetNotional()` are always live reads —
  a second candidate evaluated in the same tick can never see a stale pre-open snapshot (verified,
  not just read).
- **Structural anti-lookahead check**: a test reads `historicalReplayEngine.ts`'s own source and
  confirms, by regex, that every `barsByAsset.get(...)` call site is wrapped by `barsAsOf(...)` — the
  sole per-tick market-data chokepoint. Zero violations found.
- **10 manual reference scenarios** (LONG/SHORT × TP/SL, same-candle both-true, overnight position,
  daily/total loss crossing, target crossing, reduced size) with the expected result computed
  explicitly in the test, not inferred from the engine's own output.
- **Evaluation is a post-hoc lens, not live enforcement — already documented in Fase 11, reconfirmed
  here**: `benchmarkEvaluation.ts`'s own doc comment already states the replay simulates the FULL
  requested period regardless of a would-be FAILED/TARGET_REACHED point; the sticky
  FAILED/TARGET_REACHED state machine (`evaluateEvaluationAccount`) is what a live account would
  enforce, tested here again explicitly (including unrealized P&L from an open position correctly
  crossing a UTC day boundary via the equity curve).
- **Replay vs paper trading**: the SAME fee/slippage convention is shared across all three engines
  (replay, `backtest.ts`, live `positionStateManager.ts`) — verified by reading, not assumed.
- **Result impact**: none. No bug was found that would change Fase 11's Breakout/Momentum/Mean
  Reversion/Trend Following numbers, so nothing was re-run — per spec section 24, a fix is only
  followed by a before/after re-run when it actually changes behavior.
- **Replay Integrity / Audit panel** in `/strategy-lab` (shown once a run is loaded): dataset hash,
  execution convention, same-candle policy, fee model, slippage model, sizing convention — a small
  transparency addition, not a new screen, with a direct pointer to the test file that proves each claim.

### AI layer (spec #16, #17, #36)

`AIAnalystOutput`/`AICriticOutput` are typed JSON, never free text — both the rule-based demo
provider and the real Anthropic-backed one return exactly the same shape, so the Trade Gate,
Journal, and UI never know which one answered. The Critic actively tries to falsify the
Analyst's hypothesis (small sample size, overfitting, regime mismatch, excessive exposure) rather
than rubber-stamping it. `aiBudget.ts` tracks daily calls / monthly estimated cost / cache hit
rate and degrades to cache-only rather than ever crashing the app on quota exhaustion.

### The Adrián Sáenz lessons (spec #56) — where they actually live in code

1. *A short streak isn't an edge* → `luckVsEdge.ts` requires 30+ trades for even MEDIUM evidence,
   100+ for HIGH, regardless of win rate.
2. *State errors destroy reliability* → Position State Manager's atomic transactions + forced
   reconciliation block.
3. *API limits can break an agent* → `aiBudget.ts`'s throttle/cache-only degradation.
4. *Learning must be traceable* → `StrategyVersion` never mutates; every parameter change is a
   new version (`v1.0` → `v1.1` → `v2.0`) with the old ones kept and viewable.
5. *Losses are part of the experiment* → Post-Mortem classifies `GOOD_IDEA_BAD_RESULT` as a
   distinct, non-punished outcome from `BAD_EXECUTION`.
6. *Compare to Buy & Hold* → `benchmark.ts`; every backtest and the Strategy League show the gap.
7. *Long-term testing* → Walk-Forward + Experiments (7/30/90/180/365-day windows).
8. *Return alone isn't enough* → Strategy League's composite score explicitly penalizes small
   sample size and rewards Sharpe/Sortino/drawdown/robustness over raw return.
9. *AI can be wrong; needs independent validation* → the Critic layer, structurally unable to be
   skipped by the Trade Gate.
10. *Detect insufficient evidence* → `INSUFFICIENT_EVIDENCE` is a first-class verdict in both the
    Hypothesis Engine and Prove-It mode, not an edge case.

## What's real vs. intentionally limited

- **Real**: all indicator math, regime detection, backtest/walk-forward/Monte Carlo engines, risk
  sizing, fee/slippage simulation, the full Trade Gate, position state machine + reconciliation,
  circuit breakers, correlation-aware exposure limits, Daily Profit Protection (Fase 6, above),
  Historical Replay's full-pipeline simulation, anti-lookahead, data quality gating, IS/VALIDATION/
  OOS separation, walk-forward, robustness/overfitting/evidence classification (Fase 7-8, above),
  post-mortem classification, strategy versioning, AI budget tracking, and the autonomous bot loop
  (above). All of it runs against a real database via Prisma (SQLite for local
  dev, the desktop app, and Render; a generated Postgres schema for the Vercel deploy path — see
  `scripts/generate-postgres-schema.mjs`), not mocked.
- **Historical Replay's `HISTORICAL_REAL` mode is real, but only as real as what's been imported**
  (Fase 9/9.1 — see `docs/market-data-import.md`): real OHLCV candles reach the (reactivated)
  `MarketData` table two ways — the live Binance public API (`scripts/import-historical-market-data.mjs`,
  no API key, no orders) or a local CSV file (`scripts/import-historical-market-data-from-file.mjs`,
  `src/lib/marketData/offlineImporter.ts`), both ending in the exact same table/shape
  (`source` explicit, `isDemo: false`). In THIS sandboxed environment the live Binance path is
  blocked by network egress policy (confirmed, documented, never worked around) — the CSV path is
  the one that actually works here today. Nothing has been imported into `dev.db` as shipped, so a
  fresh checkout's `HISTORICAL_REAL` replay honestly returns `HISTORICAL DATA UNAVAILABLE` until
  someone runs one of the two importers; `dataSource: "SYNTHETIC"` (`generateHistoricalWalk`)
  remains completely untouched and is what every demo/screenshot in this repo actually used. AI mode
  `FULL_HISTORICAL` is the one path that can use genuinely real historical evidence — a real
  `AIAnalysis` row the live system already wrote — but only for the rare instant a replay's
  timestamp happens to fall within 30 minutes of one, since months-long replay ranges essentially
  never line up with this demo environment's own short live-running history.
- **Multi-asset (V3)**: `Asset.assetClass` (`CRYPTO` | `FOREX` | `METALS`) exists in the schema and
  the Dashboard's "Mercados" card is already asset-class-aware, but only `CRYPTO` has an actual
  provider/seeded assets today — Forex and Metals show "próximamente" rather than fabricated data.
  Wiring a real Forex/Metals provider is additive against the existing `MarketDataProvider`
  interface, same as swapping in a real crypto provider would be.
- **Demo by design, labeled as such**: market/news/sentiment/on-chain data is synthetic
  (deterministic per symbol/timeframe, regime-switching random walk) because there are no live
  API keys in this environment — swapping in a real provider is additive, not a rewrite (see
  Provider Abstraction above). The on-chain demo provider deliberately marks some
  metric/asset combinations `DATA UNAVAILABLE` rather than fabricating them, so that UI path is
  exercised honestly.
- **Event-Driven strategy** legitimately produces zero backtest trades: it requires *historical*
  news timestamped to match arbitrary past bars, which a "recent news" demo provider can't
  honestly provide. It fires normally in live paper-trading scans, where "recent news" is exactly
  what's needed.
- **AI Analyst/Critic** run rule-based by default (documented, labeled in the UI) and switch to
  real Claude calls the moment `ANTHROPIC_API_KEY` is set — no code change required.
- **MT5 demo integration is architecture-only, never live-tested** (see `docs/mt5-demo-integration.md`):
  `TradingExecutionAdapter`/`MT5DemoExecutionAdapter`, the demo-only safety gate, credential handling,
  duplicate-order protection, the Evaluation Risk Engine (prop-firm-style phases/targets/drawdown
  stops), the 15-point pre-flight execution checklist, MT5 lot-based position sizing, the
  EdgeLab↔MT5 symbol mapper, the position synchronizer, reconnection safety, and the `/accounts` UI
  are all real and tested — but MetaTrader 5 has no public REST API (unlike Binance), so every test
  injects a fake `Mt5ClientLike`; this repo has never connected to, and cannot test against, a real
  MT5 terminal. Live accounts are structurally rejected, never just discouraged — there is no
  `allowLiveTrading` parameter anywhere in the codebase. The MT5 execution hook into the bot loop
  (`mt5ExecutionOrchestrator.ts`) is strictly additive: Historical Replay and Paper Trading behave
  identically whether or not MT5 is connected.

## Known bug found and fixed during build (documented for transparency)

An early version of the backtester computed the entry fill's fee/slippage using a placeholder
quantity of `1` before the real position size was known, which (for prices ≠ 1) produced a
wildly wrong entry fee and could knock 50%+ off equity in a single bar. Caught via manual testing
against the live demo data (not by the type checker, which is why the Vitest suite now has an
explicit regression test — `backtest.test.ts` → "realistic, bounded P&L" — asserting equity can
never move by more than a position's actual notional in one step). Fixed by sizing first from a
price-only simulated fill, then computing the real €-denominated entry cost from the actual
quantity.

## Screens

Dashboard, Markets, Crypto Intelligence, News, Sentiment, On-Chain, Strategies, Paper Trading,
Portfolio, Trade Journal, AI Research Lab, Experiments, Backtesting, Walk Forward, Monte Carlo,
Robustness Lab, Risk Center, Strategy League, Luck vs Edge, System Health, Settings — all 21 from
the spec, all backed by live queries/engine calls (no static mockups).

## PWA

`public/manifest.json` + `public/sw.js` (network-first for navigation with an offline shell
fallback, always-network for `/api/*` so trading data is never served stale) + generated icons in
`public/icons/`. Installable to a home screen; the whole layout is mobile-first responsive
(sidebar collapses to a bottom tab bar + full-screen menu under `md:`).

## Database

Full schema in `prisma/schema.prisma` — `User`, `Asset`, `MarketData`, `News`+`NewsAssetLink`,
`SentimentSnapshot`, `OnChainMetric`, `Strategy`+`StrategyVersion`, `Backtest`+`BacktestResult`,
`Experiment`, `Hypothesis`, `PaperAccount`/`PaperOrder`/`PaperPosition`/`PositionStateChange`,
`Trade`+`TradeJournal`+`PostMortem`, `RiskEvent`, `CircuitBreaker`, `SystemAlert`, `AIAnalysis`,
`AIUsage`, `SystemHealth`, `DataQualityReport`, `Benchmark`, `AuditLog` — matching spec §47
directly, with a couple of additions (`PositionStateChange`, `PostMortem`, `DataQualityReport`,
`AIUsage`) that the reconciliation/post-mortem/data-quality/AI-budget features need to actually
persist their output rather than just compute it in memory.
