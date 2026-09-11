# Crypto AI Trading Lab

A rigorous, self-skeptical research & **paper-trading** laboratory for crypto markets.

**This system never sends real orders.** Every position, every fill, every P&L number in this
app is simulated. The point of the lab is not "a bot that makes money" — it's a set of tools
that make it hard to fool yourself into thinking a strategy has an edge when it doesn't.

## Running it

```bash
cp .env.example .env        # already done in this repo; edit if you have real DATABASE_URL/keys
npm install
npm run db:push             # create tables in PostgreSQL (DATABASE_URL in .env)
npm run db:seed             # seed 7 assets, 7 strategies, one €100 paper account
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

### Engines (`src/lib/engines/`)

Each spec module maps to one file: `dataQuality.ts`, `features.ts` (indicators), `regime.ts`,
`marketIntelligence.ts`, `news.ts`, `sentiment.ts`, `strategy/*` (7 strategies + registry),
`riskEngine.ts`, `paperExecution.ts`, `positionStateManager.ts`, `positionLifecycle.ts`
(stop/target ticking + mark-to-market), `tradeGate.ts`, `circuitBreakers.ts`, `backtest.ts`,
`walkForward.ts`, `monteCarlo.ts`, `robustness.ts`, `overfitting.ts`, `benchmark.ts`,
`hypothesis.ts`, `postMortem.ts`, `luckVsEdge.ts`, `strategyLeague.ts`, `anomalyDetector.ts`,
`aiBudget.ts`, `auditLog.ts`, `alerts.ts`. All are plain, mostly-pure TypeScript — no framework
coupling — which is what makes the 80-test Vitest suite possible without mocking half the app.

### The Trade Gate (`tradeGate.ts`)

Runs **all 11 checks every time**, never short-circuiting, so the UI can always show the full
audit trail (see the Paper Trading screen: every blocked/low-confidence candidate shows exactly
which check stopped it and why). A failed non-downgrade check → `BLOCKED`. A downgrade-only issue
(sentiment/price divergence, missing on-chain data, thin evidence) → `LOW_CONFIDENCE`, which the
Paper Trading Engine executes at **half size**, never full size — enough to keep accumulating the
real trade history that Robustness/Luck-vs-Edge need, without betting the account on a hypothesis
the system itself isn't confident in.

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
data quality, reconciliation) auto-clear once the underlying condition resolves.

### No look-ahead, ever (spec #23)

`backtest.ts` evaluates a strategy against `bars[0..i]` only, and a signal generated from bar
`i`'s close fills at bar `i+1`'s **open** — never at its own close. This is enforced structurally
(the strategy function is only ever handed a truncated array), not by convention, and is covered
by a dedicated regression test (`backtest.test.ts`) that fails if the window ever grows
out of order or a fill uses same-bar data.

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
  circuit breakers, post-mortem classification, strategy versioning, AI budget tracking. All of
  it runs against a real PostgreSQL database via Prisma, not mocked.
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
