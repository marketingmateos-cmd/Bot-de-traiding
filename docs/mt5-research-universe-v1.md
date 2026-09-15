# MT5 Research Universe v1

**This is a READ-ONLY specification.** It creates no `ResearchDataset`, calls
no MT5 execution API, downloads no bulk history, and fills/interpolates no
candle. It exists purely to declare — from data actually confirmed against a
real MT5 DEMO terminal in the MT5 Data Connector phases already committed on
this branch — which markets and timeframes are candidates for future research,
and under what explicit conditions.

The machine-readable source of truth is
`src/lib/research/mt5ResearchUniverseV1.ts` (18 entries: 6 canonical symbols ×
H1/H4/D1). This document is its human-readable companion; if the two ever
disagree, the code (and its tests) wins.

---

## 1. Security posture (unchanged by this phase)

- `ENABLE_DEMO_EXECUTION` remains `false`.
- No `order_send` call, no execution API, anywhere in this phase's files.
- No credential is printed, logged, or committed; `.env.local` was not touched.
- No `ResearchDataset` row is created by this phase — see §7.

## 2. Where the confirmed data comes from

Everything below traces to one of two real, already-committed scripts run
against the MEX Atlantic Corporation MT5 DEMO account (server
`MEXAtlantic-Demo`):

- `python/mt5_historical_discovery.py` — the original 15-pair run
  (BTCUSD/ETHUSD/US500/EURUSD/USDJPY × H1/H4/D1): 9/15 OK
  (BTCUSD, ETHUSD, US500), 6 `SYMBOL_NOT_FOUND` (EURUSD, USDJPY — exact-match
  only, see §4).
- `python/mt5_symbol_resolution.py` — resolved EURUSD/USDJPY/XAUUSD via the
  broker's own symbol metadata (`MB Pro\Forex\...`, `MB Pro\Gold\...`) and
  ran a small read-only validation: 9/9 pairs OK, 500/500 OHLC valid, 0
  duplicates.

Every field in the registry is either a number/string one of those two real
runs actually reported, or an explicit `null` — never a guess, an estimate
treated as a fact, or a value copied from a different symbol's report.

## 3. The universe

| Canonical | Asset class | Broker path (confirmed) | Broker-native symbol |
|---|---|---|---|
| BTCUSD | CRYPTO | `Crypto CFD` | `BTCUSD` (exact match, confirmed) |
| ETHUSD | CRYPTO | `Crypto CFD` | `ETHUSD` (exact match, confirmed) |
| US500 | INDEX | `Cash indices` | `US500` (exact match, confirmed) |
| EURUSD | FX | `MB Pro\Forex` | **not captured** — see §4 |
| USDJPY | FX | `MB Pro\Forex` | **not captured** — see §4 |
| XAUUSD | METAL | `MB Pro\Gold` | **not captured** — see §4 |

## 4. Why three broker-native symbols are `null` — and why that's correct

The source message reported EURUSD/USDJPY/XAUUSD's broker-native names
truncated (`"EURUSD..."`, `"USDJPY..."`, `"XAUUSD..."`). Inventing a plausible
suffix (`EURUSDm`, `EURUSD.pro`, ...) would violate the explicit "no
inventar" requirement this phase operates under, so `mt5ResearchUniverseV1.ts`
records `brokerNativeSymbol: null` for all nine of those entries instead —
honestly incomplete beats confidently wrong. Fix it by running:

```
python python\mt5_symbol_resolution.py --json-out resolution-report.json
```

and copying the real `resolved` value for each root into the registry's
`RAW_ENTRIES` for EURUSD/USDJPY/XAUUSD.

The broker **category** (`MB Pro\Forex`, `MB Pro\Gold`) IS confirmed and
recorded — these are two different confirmation levels, tracked as two
different fields (`brokerPath` vs `brokerNativeSymbol`), never conflated.

## 5. Historical depth (confirmed)

| Symbol | Timeframe | Earliest available | Latest available |
|---|---|---|---|
| BTCUSD | H1 | 2025-10-27 | 2026-09-15 |
| BTCUSD | H4 | 2020-12-16 | 2026-09-15 |
| BTCUSD | D1 | 2020-12-16 | 2026-09-15 |
| ETHUSD | H1 | 2025-11-01 | 2026-09-15 |
| ETHUSD | H4 | 2020-12-16 | 2026-09-15 |
| ETHUSD | D1 | 2020-12-16 | 2026-09-15 |
| US500 | H1/H4/D1 | 2016-05-05 | 2026-09-15 |
| EURUSD | H1/H4/D1 | 2017-04-03 | not restated for this symbol — `null` |
| USDJPY | H1/H4/D1 | 2017-04-03 | not restated for this symbol — `null` |
| XAUUSD | H1/H4/D1 | 2017-04-03 | not restated for this symbol — `null` |

**BTCUSD/ETHUSD H1 depth is notably shallow (~11 months)** compared to their
own H4/D1 (~5.7 years) — this is a real, confirmed asymmetry, not a data
error. Rule `no-timeframe-window-beyond-depth` (§6) exists specifically for
this case.

## 6. Rules for future research (`RESEARCH_UNIVERSE_V1_RULES`)

Each rule below has a stable `id` in the code — cite the id, never
re-derive the rule from scratch in a future pre-registration file.

1. **`no-cross-asset-comparison-without-declared-window`** — don't compare
   strategies across assets whose historical windows differ without
   declaring the difference explicitly.
2. **`no-timeframe-window-beyond-depth`** — don't treat a timeframe as having
   multi-year depth if its confirmed `earliestAvailable` doesn't support that
   window (BTCUSD/ETHUSD H1 above all).
3. **`no-fill-no-interpolate`** — never synthesize a missing candle, ever.
4. **`structural-gaps-are-not-corruption`** — `weekend_close` /
   `daily_session_break` gaps are expected market structure, not a data
   defect.
5. **`unclassified-gaps-pending-audit`** — `unclassified` gaps are preserved
   and flagged (`pendingAuditGapCount`), never silently reclassified.
6. **`future-datasets-preserve-full-provenance`** — any `ResearchDataset`
   built later from this universe must keep canonical symbol +
   broker-native symbol + timeframe + timestamps + provenance
   (`"mt5_demo"`) + dataset hash together — never just the canonical symbol.
7. **`no-single-asset-robustness-claim`** — one asset/timeframe working is
   never "robust" by itself; the same cross-validation standard F17–F22
   already apply to crypto applies here.
8. **`no-broker-native-symbol-guessing`** — resolve via
   `mt5_symbol_resolution.py` against the real broker before using a
   broker-native name; never borrow a pattern from another symbol or broker.
9. **`read-only-until-explicit-ingestion-phase`** — appearing here with
   `researchFitness: "AUTHORIZED_FOR_RESEARCH"` authorizes nothing to be
   downloaded in bulk or registered as a `ResearchDataset` automatically;
   that is a separate, explicit future phase.

## 7. What "authorized" means here — and what it doesn't

`researchFitness: "AUTHORIZED_FOR_RESEARCH"` means: the symbol and timeframe
both exist on this broker, AND at least one validated sample exists with
zero **known** invalid or duplicate rows. It does **not** mean:

- the symbol has been ingested, or has a `ResearchDataset` (none exists yet
  — see rule 9);
- every gap has been explained (`pendingAuditGapCount` can be non-zero on an
  authorized entry — see §8);
- the full historical range has been validated (only a bounded recent
  sample has — see `sampleMaxRowsRequested`/`sampleSize`).

Currently: the 9 EURUSD/USDJPY/XAUUSD pairs are `AUTHORIZED_FOR_RESEARCH`
(a real, clean 500-row sample exists for each). BTCUSD/ETHUSD/US500's 9
pairs are `NOT_AUTHORIZED` under this registry's strict rule — **not**
because anything is wrong with them, but because their per-pair
`sampleSize`/`invalidCount`/`duplicateCount` were never individually
reported in this session's transcripts (only the aggregate "9/15 OK" symbol/
timeframe-availability result and, for a few pairs, a gap count). Re-run
`mt5_historical_discovery.py --json-out` and fill in those fields to
authorize them.

## 8. Gaps pending audit — never reclassified by assumption

| Symbol | Timeframe | Unclassified gaps | Status |
|---|---|---|---|
| BTCUSD | D1 | 254 | pending re-verification (pre-fix figure, see below) |
| ETHUSD | D1 | 254 | pending re-verification (pre-fix figure, see below) |
| EURUSD | D1 | 4 | pending audit |
| USDJPY | D1 | 4 | pending audit |
| XAUUSD | D1 | 6 | pending audit |
| US500 | H1 | 2 | pending audit |

**BTCUSD/ETHUSD's 254 figure predates a real bug fix** (`classify_gap()`,
commit `80b7bc8`): D1 bars are always stamped `00:00`, so the old
Friday-`hour>=12` weekend check could never fire for D1 data, silently
mislabeling every ordinary weekly closure as `unclassified`. The math is
consistent with that explanation (≈285 weeks across the confirmed 5.7-year
D1 range), but no post-fix real run has been reported — so this registry
keeps 254 as the recorded figure, annotated as provisional, rather than
guessing what a re-run would show.

**US500's 2 unclassified H1 gaps** don't match either the weekly-closure or
daily-rollover pattern; the most likely causes (a holiday, a DST shift, or a
longer maintenance window) are documented but not confirmed — resolving
this requires MT5's own `symbol_info().session_*` data or the exact gap
timestamps, neither of which this connector reads.

None of this is fabricated resolution — every entry above stays
`unclassified` in the registry, exactly as reported, with its own `notes`.

## 9. Next steps this phase does NOT take

- No bulk historical download.
- No `ResearchDataset` registration.
- No strategy discovery (F23 or otherwise).
- No re-classification of any `unclassified` gap.
- No broker-native symbol filled in without a real `mt5_symbol_resolution.py`
  re-run.

Those are separate, future, explicitly-scoped phases.
