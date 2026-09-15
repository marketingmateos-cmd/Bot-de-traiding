# MT5 DEMO — Read-Only Data Connector

**This connector is for historical data ingestion only. It cannot place, modify,
or close a single order — not even on a demo account.** Execution remains
governed entirely by the existing MT5 Fase 1/2 machinery (see
`docs/mt5-demo-integration.md`), which this phase never relaxes.

---

## 1. What this is, in one picture

```
MT5 DEMO
   ↓ (connect, verify DEMO, read-only)
Read-only connector (TradingExecutionAdapter.getHistoricalBars)
   ↓
Historical OHLCV bars
   ↓
Validation (candleValidation.ts — same as every other real import)
   ↓
SHA-256 (computeDatasetHash — same algorithm as Binance datasets)
   ↓
ResearchDataset (registerResearchDataset — unmodified)
   ↓
Research / Replay / Backtesting (Fase 7-22, unmodified)
```

There is **no** `MT5 → Signal → Order` path anywhere in this phase. The
ingestion code (`src/lib/marketData/mt5HistoricalIngestion.ts`,
`python/mt5_data_connector.py`) never imports or calls anything
order-shaped — enforced by structural tests that grep both files' own
source for `placeOrder`/`orderSend`/`order_send`.

## 2. Why this repository has never connected to a real MT5 terminal

MetaTrader 5 has no public REST API. Its official API — the `MetaTrader5`
Python package used by `python/mt5_data_connector.py` — only works
against a **real MT5 terminal process on the same machine** (Windows, or
Wine), and the Python package itself **only installs on Windows**. This
sandboxed development environment is Linux and cannot run a real MT5
terminal, so nothing in this repository — not this phase, not the earlier
MT5 Fase 1/2 execution work — has ever exercised a real end-to-end
connection. See `docs/mt5-demo-integration.md` for the same constraint on
the execution side.

**What this means concretely:**
- `python/mt5_data_connector.py` and `python/mt5_connection_test.py` are
  complete, correct implementations against the official API — meant to
  run on a real Windows/Wine machine with a real MT5 DEMO terminal
  installed. They were verified here for syntax, logic, credential
  safety, and byte-for-byte hash consistency with the TypeScript side —
  never against a real broker.
- The TypeScript side's `Mt5ClientLike` (`src/lib/execution/mt5Client.ts`)
  is dependency-injected, exactly like the Binance importer's `FetchLike`.
  The only implementation shipped in this repo is
  `createUnavailableMt5Client()`, which always honestly reports "not
  connected" with an explanation — never a fabricated connection. A real
  deployment supplies its own `Mt5ClientLike` (e.g. a small Windows-side
  companion process spawning `python/mt5_data_connector.py` and talking
  to it over stdio/a socket) — a one-line change in
  `src/lib/execution/registry.ts`, nothing else in the app needs to know.
- Every test in this phase uses a fake `Mt5ClientLike`
  (`src/lib/execution/__tests__/testFixtures.ts`'s `makeFakeMt5Client`) —
  same pattern MT5 Fase 1/2 already established.

## 3. Configuration — `.env.local`

Copy from `.env.example` and fill in:

```
MT5_LOGIN=
MT5_PASSWORD=
MT5_SERVER=
ENABLE_DEMO_EXECUTION=false
```

- `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` — your MT5 **DEMO** account's
  credentials. Never commit `.env.local` (already covered by `.env*` in
  `.gitignore`). If any of the three is missing, both the TypeScript side
  (`getMt5CredentialsFromEnv()`, `src/lib/execution/mt5CredentialConfig.ts`)
  and the Python side (`get_mt5_config()`,
  `python/mt5_data_connector.py`) fail with the exact same safe message —
  `"MT5 configuration is incomplete"` — and **never** say which variable
  is missing.
- `ENABLE_DEMO_EXECUTION` — see §5. Must stay `false` for this phase.

## 4. The inviolable DEMO safety check

Immediately after login, both sides check the account's mode against the
**official MT5 attribute**, never a proxy:

- Python: `mt5.account_info().trade_mode` compared against
  `mt5.ACCOUNT_TRADE_MODE_DEMO` (`assert_demo_or_raise()` in
  `mt5_data_connector.py`).
- TypeScript: `TradingExecutionAdapter.verifyAccountIsDemo()` →
  `verifyAccountIsDemo()` in `src/lib/execution/demoAccountGuard.ts`
  (unmodified, from MT5 Fase 1) — reads `accountType` exactly as the
  client reports it, treats anything that isn't the literal `"DEMO"`
  (missing, null, `"LIVE"`, unrecognized) as **not verified demo**.

Never used as a substitute: server name, account comment, symbol,
broker name, or an environment variable. A REAL account, or an
unrecognized/unknown mode, always aborts — no data is ingested, no
execution is initialized, nothing continues.

## 5. Execution kill switch — `ENABLE_DEMO_EXECUTION`

An **additional**, environment-level precondition on top of the existing
DB-backed Safety Switch (`MT5DemoConnection.executionEnabled`, MT5 Fase 1).
Both must be true before `MT5DemoExecutionAdapter.placeOrder()` will ever
call the underlying client:

1. `ENABLE_DEMO_EXECUTION` must be the literal string `"true"` — checked
   live (a getter, `src/lib/env.ts`) both inside `canEnableMt5Execution()`
   (`src/lib/execution/demoAccountGuard.ts` — the only path that can ever
   flip the DB flag to `true`) **and** directly inside `placeOrder()`
   itself (defense in depth — even a stale/tampered DB flag is refused).
2. The DB Safety Switch (`executionEnabled`) must also be `true` —
   unchanged from MT5 Fase 1, always resets to `false` on every fresh
   connection.

For this phase, `ENABLE_DEMO_EXECUTION` is `false` in `.env.example` and
is never set to `true` anywhere in this repository's code. The historical
ingestion path (`ingestMt5HistoricalData`) never touches this flag or
`placeOrder` at all — it is structurally incapable of executing an order,
not merely gated by a flag that happens to be off.

## 6. Symbol discovery and mapping

Reuses the existing `Mt5SymbolMapping` table and
`src/lib/execution/mt5SymbolMapper.ts` (MT5 Fase 2) — never a second
mapping system. `discoverMt5Symbols()` tries a short list of candidate
broker-specific names per EdgeLab canonical symbol against the **live**
terminal's own `getSymbols()`, and persists only a match the terminal
actually confirmed:

| EdgeLab symbol | Candidates tried (in order) |
|---|---|
| EURUSD | EURUSD |
| GBPUSD | GBPUSD |
| USDJPY | USDJPY |
| XAUUSD | XAUUSD, GOLD |
| US500 | US500, SPX500, US500.cash, SP500 |
| NAS100 | NAS100, USTEC, NAS100.cash, US100 |
| DAX | DAX, GER40, DE40, GER30 |

A symbol with no matching candidate on the connected broker is reported
`found: false` — never invented, never silently skipped.

## 7. Historical data ingestion

Timeframes: **H1, H4, D1** — MT5's own native timeframes, requested
directly via `mt5.copy_rates_range()`; **no resampling** (MT5 already
provides these natively, unlike the H1→H4/D1 resample built in the prior
"extender BTC/ETH a H4/D1" phase for Binance data, which had no native
higher-timeframe source).

Each bar carries `timestamp, open, high, low, close, volume` (canonical
fields, flow straight into the existing pipeline) plus, when MT5 reports
them, `tick_volume, spread, real_volume`. **`volume` = `tick_volume`**,
never `real_volume` — for most FX/CFD symbols `real_volume` is 0 or
unreliable (no centralized tape), while `tick_volume` (price-change count)
is always populated and is the same proxy the rest of this codebase
already uses for "volume" on instruments without a true traded-volume
feed. This is documented, not silently substituted.

### Pipeline

```
adapter.connect(credentials)
adapter.verifyAccountIsDemo()        // aborts here if not DEMO
resolveMt5Symbol(edgeLabSymbol, adapter)   // mt5SymbolMapper.ts, unmodified
adapter.getHistoricalBars(mt5Symbol, timeframe, start, end)   // READ only
importHistoricalMarketDataForBars(...)     // offlineImporter.ts — SAME
                                            // validation/upsert/idempotency
                                            // as the Binance CSV path
registerResearchDataset(...)               // researchDataset.ts, unmodified
```

`importHistoricalMarketDataForBars` is a new entry point into the
**existing** `offlineImporter.ts` persistence core (`persistOfflineBars`,
shared with the Binance CSV path — never duplicated) for callers that
already have bars in memory and their own internal symbol, bypassing
Binance's `resolveInternalSymbol`/`BINANCE_SYMBOL_MAPPINGS` (which has no
entry for "EURUSD" and shouldn't).

### Quality gates (reused, unmodified)

- OHLC validity, chronological order, duplicate/gap detection: the SAME
  `validateCandleBatch()` + `computeMarketDataCoverage()` every other real
  import in this codebase uses.
- A dataset that doesn't clear these is never registered as a
  `ResearchDataset` row.

## 8. Provenance — `ResearchDataset`

Registered via the **unmodified** `registerResearchDataset()`
(`src/lib/research/researchDataset.ts`, Fase 14). MT5 rows use
`source: "mt5_demo"` by default — always distinct from any Binance
source label (`"binance"`, `"binance_csv"`, `"binance_csv_resampled_h1"`)
— so MT5 and Binance data for a symbol/timeframe are never mixed under
the same provenance, and `@@unique([symbol, timeframe, startDate, endDate, source])`
keeps them as separate rows even if a symbol name were ever to collide.

## 9. SHA-256 dataset hash

Identical convention on both sides, deliberately kept in sync (see
`compute_dataset_hash()`'s own docstring in
`python/mt5_data_connector.py` and `computeDatasetHash()` in
`src/lib/research/researchDataset.ts`, Fase 14, unmodified):

1. Sort rows chronologically.
2. Per row: `${timestamp.toISOString()}|${open}|${high}|${low}|${close}|${volume}`
   — numbers formatted exactly like JavaScript's `Number.prototype.toString()`
   (a whole-number float like `100.0` becomes `"100"`, never `"100.0"` —
   see `_js_number_str()` on the Python side, the one necessary correction
   versus Python's own `repr()`/`str()`).
3. Join lines with `"\n"`.
4. SHA-256, hex digest.

Verified byte-for-byte identical between the Python and TypeScript
implementations for the same synthetic dataset (see
`src/lib/marketData/__tests__/mt5PythonConnector.test.ts`).

## 10. Idempotency

Running the same ingestion (same source, symbol, timeframe, range) twice
never duplicates `MarketData` rows — inherited from `offlineImporter.ts`'s
existing diff-based upsert (unique on `assetId, timeframe, timestamp, source`).
A second run reports `duplicates`, not new `inserted` rows, and
`registerResearchDataset` returns the same `ResearchDataset` row rather
than creating a second one for the same range.

## 11. Running the standalone connection test

```
python3 python/mt5_connection_test.py [--symbol EURUSD] [--rows 1000]
```

Reads `.env.local` (optional — falls back to already-exported
environment variables), connects, authenticates, verifies DEMO, prints
only safe diagnostic info (masked login, server, account mode, demo
balance/currency, discovered symbol, bar count, date range, dataset
hash), downloads up to `--rows` H1 bars, validates OHLC, computes the
SHA-256, and disconnects. **Never** opens/closes/modifies a position or
sends an order — there is no code path in this script that could, since
it never imports anything order-shaped from `mt5_data_connector.py`.

On this Linux sandbox it fails honestly at the "MetaTrader5 package not
available" step (§2) — this is expected and correct here; run it on a
real Windows/Wine machine with a real MT5 DEMO terminal to actually
exercise it end to end.

## 12. Running ingestion for real

```
npx tsx scripts/mt5-ingest-historical.mjs --symbol EURUSD --timeframe H1 --start 2024-01-01 --end 2024-06-01
```

Uses the same `getMt5ExecutionAdapter()` singleton as the rest of the app
— in this environment, always the honest "unavailable" stub (§2). Against
a real deployment with a real `Mt5ClientLike` wired into
`src/lib/execution/registry.ts`, this connects, verifies DEMO, discovers
the symbol, downloads bars, validates, persists, and registers a
`ResearchDataset` — printing the same safe diagnostic fields as the
connection test script.

## 13. Known limitations

- **No real MT5 terminal available in this development environment** (§2)
  — nothing in this phase's code has been exercised against a real
  broker. The Python module and CLI script are complete and correct
  against the official API's documented behavior, verified for syntax,
  credential safety, and cross-language hash consistency, but not for
  real-world API quirks a specific broker's terminal might exhibit.
- Volume is `tick_volume`, a proxy, not always true traded volume — see §7.
- Symbol discovery only tries the candidate list in §6; a broker using an
  entirely different naming convention needs a manual
  `setSymbolMapping()` call (same mechanism as MT5 Fase 2).
- No resampling is implemented for the MT5 path — only H1/H4/D1 as MT5
  itself provides them natively.

## 14. Running a REAL smoke test — on Windows, with a real MT5 DEMO terminal

Everything in §1-13 above has only ever been exercised against fakes in
this Linux sandbox. This section is for running it for real, on a Windows
machine with MetaTrader 5 installed and a DEMO account.

### 14.1 Precheck

```
python3 python\mt5_precheck.py
```

Checks — without connecting, logging in, or printing any secret — that:
Windows is detected, Python is 3.8+, the `MetaTrader5` package imports,
`mt5.initialize()` can reach a real terminal (never logs in, immediately
shuts the connection back down), and `MT5_LOGIN`/`MT5_PASSWORD`/
`MT5_SERVER` are present (read from `.env.local` if present). Prints
exactly which check(s) are `[MISSING]`, including WHICH variable name(s)
are absent — never their values. Exit code 0 only when every check
passes.

### 14.2 The real connection test

```
python3 python\mt5_connection_test.py
```

Before anything else, this checks `ENABLE_DEMO_EXECUTION` and aborts
immediately (printing nothing else) if it's `"true"` — this smoke test
stays READ-ONLY even against a genuine DEMO account. It then loads
`.env.local`, connects, logs in, reads `account_info()`, and checks
`ACCOUNT_TRADE_MODE` against `ACCOUNT_TRADE_MODE_DEMO` — aborting for any
REAL or unrecognized mode, never accepting a server name or comment as a
substitute. Symbol discovery tries `EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`
first, then the three indices (`US500`/`NAS100`/`DAX`) via the same
broker-specific candidate list `mt5SymbolMapper.ts` uses (kept in sync,
verified by a cross-language consistency test) — the first candidate that
actually exists on the connected broker wins; nothing is ever invented.
It downloads up to `--rows` (default 1000) H1 bars, validates OHLC,
counts duplicates and gaps, computes the SHA-256, and disconnects.

Expected output (values will differ per account/broker):

```
=== MT5 DEMO CONNECTION TEST (read-only) ===
[MT5] Login: ••••••78
[MT5] Server: MetaQuotes-Demo
[MT5] Connecting to demo server
[MT5] Account mode: DEMO (trade_mode=0)
[MT5] Demo account verified
[MT5] Server: MetaQuotes-Demo
[MT5] Trade mode: 0 (ACCOUNT_TRADE_MODE_DEMO)
[MT5] Balance: 10000.0 USD
[MT5] Equity: 10000.0 USD
[MT5] Broker: MetaQuotes Software Corp.
[MT5] Symbol discovered: EURUSD (target: EURUSD)
[MT5] Downloaded 1000 H1 bars
[MT5] OHLC validation: 1000/1000 bars valid (0 invalid)
[MT5] Duplicate count: 0
[MT5] Gap count: 0
[MT5] Date range: 2025-08-xx...Z -> 2025-09-xx...Z
[MT5] Dataset hash: <64-char hex>
[MT5] Connection test PASSED — read-only, no order was ever sent.
```

A non-zero exit code with a `[MT5] ...` line explaining exactly what
failed (never a stack trace with a credential in it) means something in
§14.1's checklist still needs fixing, the account isn't DEMO, or no
candidate symbol exists on this broker.

### 14.3 Ingestion for real (once §14.2 passes)

```
npx tsx scripts\mt5-ingest-historical.mjs --symbol EURUSD --timeframe H1 --start 2024-01-01 --end 2024-06-01
```

Same command as §12 — nothing about it changes for a real terminal, since
`getMt5ExecutionAdapter()` is the one place a real `Mt5ClientLike` gets
wired in (§2). Do **not** run this for a large date range on the first
real attempt — start narrow, confirm the printed `rowCount`/`gapCount`/
`datasetHash` look sane, then widen the range.

## 15. Broker symbol survey and gap classification (read-only)

Once §14.2 passes, run the survey before ingesting anything, to see what
this specific broker actually exposes — never assume EURUSD, XAUUSD, or
any other "standard" name exists (§6):

```
python3 python\mt5_symbol_survey.py [--symbol US500] [--timeframe H1] [--rows 1000] [--limit 40]
```

Like the connection test, it checks `ENABLE_DEMO_EXECUTION` first and
aborts if `"true"`. It then:

1. Calls `mt5.symbols_get()` — a pure metadata read, never
   `symbol_select()` (which would change Market Watch visibility) — and
   groups every returned symbol by the **broker's own** `path` metadata
   (e.g. `"Forex\Majors\EURUSD"`, `"Indices\US500"`), never by
   pattern-matching the name. A symbol with no `path` lands in
   `"Unclassified"`.
2. Runs the same symbol discovery order as the connection test
   (EURUSD/GBPUSD/USDJPY/XAUUSD, then US500/NAS100/DAX), downloads up to
   `--rows` bars (diagnostic scale, same cap as §14.2 — **not** a bulk
   import), and for every detected gap prints its `after`/`before`
   boundaries, `missing` candle count, and a best-effort
   `classify_gap()` label:
   - `weekend_close` — starts Friday afternoon/evening (or on the
     weekend) and ends Sunday/Monday — the ordinary weekly closure.
   - `daily_session_break` — a short gap (≤3h) on any other day — the
     common nightly quote-rollover pause many brokers apply to CFD/index
     symbols.
   - `unclassified` — matches neither pattern; MT5's per-symbol
     `session_*` fields (not read here) would resolve it precisely — treat
     it as "needs a manual look," never as a confirmed anomaly on its own.

This is a heuristic aid, not ground truth — cross-check any
`unclassified` gap against the broker's own published session calendar
before treating it as a real data problem.

## 16. Real broker results (MEX Atlantic Corporation, 2026-09-15) and next steps

A real smoke test (§14.2) against a genuine MEX Atlantic Corporation DEMO
account confirmed the architecture end to end: DEMO verified
(`trade_mode=0`), 701 real H1 bars for `US500`, 701/701 valid OHLC, 0
duplicates, 30 gaps, hash `c836cf9685470a0b0d7c81ecb4f4c9bca430ca96c0e65896be72abaaa34d3528`,
no order ever sent. None of the default Forex/metal candidates
(EURUSD/GBPUSD/USDJPY/XAUUSD/GOLD) were found on this broker under those
exact names — confirming §6's "never assume a standard name matches this
broker" is not a theoretical concern here. A synthetic reconstruction
(6 weekly closures + one ~1h daily rollover gap per trading day over the
same 6-week span) independently reproduces exactly 30 gaps split as 6
`weekend_close` + 24 `daily_session_break` — consistent with ordinary
market structure, not an anomaly, pending confirmation from §15's actual
per-gap breakdown on this broker's real data.

**Before any bulk ingestion on this broker:** run §15 to get the full
symbol list (grouped by this broker's own categories) and the confirmed
gap classification for `US500`, then run §17 (historical discovery) to
find out how much history is actually available per symbol/timeframe,
then ingest only symbols/ranges §17 confirms are practical — one narrow
range at a time via §14.3, verifying `rowCount`/`gapCount`/`quality`/
`datasetHash` after each run before widening the range or adding another
symbol.

## 17. Historical discovery — read-only, no database writes

```
python3 python\mt5_historical_discovery.py \
    [--symbols BTCUSD,ETHUSD,US500,EURUSD,USDJPY] \
    [--timeframes H1,H4,D1] \
    [--max-rows 2000] \
    [--json-out discovery-report.json]
```

Answers "how much usable history does this broker actually provide" for
a set of symbol/timeframe pairs, WITHOUT downloading a symbol's entire
history to find out and WITHOUT writing anything to the app's database —
no `ResearchDataset` row is created by this script. That decision
(whether a discovered range is worth ingesting) is made by a human
reading this report; actual persistence still happens later, unchanged,
via §12/§14.3 (`ingestMt5HistoricalData()` / `scripts/mt5-ingest-historical.mjs`).

### How it finds the range without a bulk download

For each pair, two SINGLE-ROW reads establish the full practical range:

- `probe_earliest_bar()` — `mt5.copy_rates_from(symbol, tf, 1990-01-01, 1)`.
  MT5 returns the first bar at-or-after the given date; since 1990
  predates any real broker's history, this is genuinely the earliest bar
  available, fetched as exactly one row.
- `probe_latest_bar()` — `mt5.copy_rates_from_pos(symbol, tf, 0, 1)`, the
  single most recent bar.

Then a bounded VALIDATION SAMPLE — up to `--max-rows` (default 2000) most
recent bars via `get_recent_bars()` (`copy_rates_from_pos(symbol, tf, 0,
max_rows)`) — is what actually gets validated, hashed, and reported in
detail (OHLC validity, duplicates, gap classification per §15). This
sample is deliberately NOT the full range — expand `--max-rows` or move
to a real ingestion (§12) only once the sample looks practical.

### What gets computed on the sample

- **OHLC validation** (`validate_ohlc_bars()`) — the exact same rules as
  `candleValidation.ts`'s `validateOneCandle()`: open/high/low/close
  finite and > 0, volume finite and >= 0, high >= low/open/close, low <=
  open/close. Invalid bars are reported, never silently dropped from the
  count.
- **Duplicate count** and **gap count/classification** (§15) run over the
  RAW sample — a diagnostic of what the broker actually returned, same
  convention as §11/§15's scripts.
- **SHA-256 hash** (`compute_dataset_hash()`) is computed over VALID bars
  ONLY — mirroring what a real ingestion of this exact sample would
  persist and hash, so the number reported here is directly comparable to
  what §12 would later produce for the same range.
- **`estimated_total_candles_full_range`** — `round(span / step) + 1`
  over the full earliest→latest span from the two probes. An ESTIMATE
  (assumes zero gaps), never an actual count — the true count is only
  knowable by downloading the whole range, which this phase avoids.

### Timezone handling (read before trusting a timestamp)

Every timestamp is formatted via the SAME `_iso_ms_utc()` convention used
everywhere else in `mt5_data_connector.py`: the raw MT5 epoch value is
labeled `"Z"` (UTC) WITHOUT adjusting for the broker's actual server-time
offset. MT5 terminals commonly run on a broker-specific server clock
(often UTC+2/UTC+3, e.g. EET/EEST) that is not necessarily UTC, and the
`MetaTrader5` Python package has no reliable, universal field for that
offset to correct for automatically. Treat every timestamp from this
script as **"broker server time, labeled UTC"** until the broker's real
offset is confirmed separately (e.g. from the broker's own
documentation) — this is documented explicitly here rather than silently
assumed correct.
