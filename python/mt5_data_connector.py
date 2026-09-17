"""
EdgeLab AI — MT5 DEMO READ-ONLY DATA CONNECTOR.

Talks to a real MetaTrader 5 terminal through the OFFICIAL `MetaTrader5`
Python package. That package only installs/works on Windows (it wraps
terminal64.exe's API and requires an MT5 terminal process running on the
SAME machine, or under Wine) — it is architecturally unavailable on this
Linux sandbox, which is why nothing in this repository has ever exercised
a real end-to-end connection (see docs/mt5-data-connector.md and
docs/mt5-demo-integration.md, which document the same constraint for the
TypeScript side's `Mt5ClientLike`). This module is nonetheless a complete,
correct implementation, meant to run on a real Windows/Wine machine with a
real MT5 DEMO terminal installed.

READ-ONLY BY DESIGN: this module never calls `order_send`, `order_check`,
`order_calc_margin`, `order_calc_profit`, or any other order/position-
modifying MT5 function. A structural test (TypeScript side, greps this
file's own source) fails the build if it ever does. The only MT5 API
surface used here is: initialize, login, account_info, symbols_get/
symbol_info, copy_rates_range, copy_rates_from, copy_rates_from_pos,
shutdown, last_error.

Environment variables (never hard-coded, never logged, never included in
any exception message):
    MT5_LOGIN
    MT5_PASSWORD
    MT5_SERVER
"""

from __future__ import annotations

import hashlib
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence

try:
    import MetaTrader5 as mt5  # type: ignore[import-not-found]

    _IMPORT_ERROR: Optional[BaseException] = None
except ImportError as exc:  # pragma: no cover - exercised only on non-Windows environments
    mt5 = None  # type: ignore[assignment]
    _IMPORT_ERROR = exc


class Mt5ConfigError(Exception):
    """Raised when required MT5 credentials are missing from the environment. Never names which one."""


class Mt5ConnectionError(Exception):
    """Raised for any transport/initialize/login/API failure. Messages come from MT5's own last_error(), never a credential."""


class Mt5NotDemoError(Exception):
    """THE inviolable safety check failure (spec section 2). Never includes account/balance/login details."""


class Mt5ExecutionEnabledError(Exception):
    """Raised when ENABLE_DEMO_EXECUTION=true (MT5 REAL DEMO smoke test phase, spec section 5).

    Nothing in this module or its callers ever calls order_send/placeOrder
    regardless of this flag — but the real-hardware smoke test scripts
    refuse to even START if the kill switch is misconfigured to "true",
    as an extra, explicit, defense-in-depth abort rather than relying
    solely on "we just never call that function"."""


@dataclass(frozen=True)
class Mt5Config:
    login: int
    password: str
    server: str


def get_mt5_config() -> Mt5Config:
    """Reads MT5_LOGIN/MT5_PASSWORD/MT5_SERVER from the environment.

    Fails with the exact, safe message "MT5 configuration is incomplete"
    when any of the three is missing or MT5_LOGIN isn't a valid integer —
    deliberately never says WHICH one, so no exception message, log line,
    or surfaced error can leak "which credential is/isn't configured" as
    a side channel.
    """
    login_raw = os.environ.get("MT5_LOGIN")
    password = os.environ.get("MT5_PASSWORD")
    server = os.environ.get("MT5_SERVER")

    if not login_raw or not password or not server:
        raise Mt5ConfigError("MT5 configuration is incomplete")

    try:
        login = int(login_raw)
    except ValueError:
        raise Mt5ConfigError("MT5 configuration is incomplete") from None

    return Mt5Config(login=login, password=password, server=server)


def assert_execution_disabled_or_raise() -> None:
    """Mirrors the TypeScript side's `env.isDemoExecutionEnabledByEnv`
    (src/lib/env.ts): same env var, same normalization (default "false",
    trimmed, lower-cased, exact-match "true"). Every real-hardware
    data-connector entry point (mt5_connection_test.py, and the ingestion
    CLI's own check on the TypeScript side) calls this FIRST, before doing
    anything else — including before reading MT5 credentials — so a
    misconfigured ENABLE_DEMO_EXECUTION=true aborts immediately and
    visibly rather than only being *incidentally* safe because this
    read-only module never calls an execution function."""
    enabled = os.environ.get("ENABLE_DEMO_EXECUTION", "false").strip().lower() == "true"
    if enabled:
        raise Mt5ExecutionEnabledError(
            "ENABLE_DEMO_EXECUTION is true — refusing to run. This connector and its "
            "scripts are READ-ONLY by design; set ENABLE_DEMO_EXECUTION=false (or unset it) "
            "before running any MT5 data connector script."
        )


def _require_mt5_package() -> None:
    if mt5 is None:
        raise Mt5ConnectionError(
            "The MetaTrader5 Python package is not available in this environment "
            "(it only installs on Windows, talking to a local MT5 terminal process — "
            "see docs/mt5-data-connector.md). Import error: "
            f"{type(_IMPORT_ERROR).__name__ if _IMPORT_ERROR else 'unknown'}"
        )


def initialize_and_login(config: Mt5Config) -> None:
    """Initializes the MT5 terminal connection and logs in. Raises Mt5ConnectionError on any failure — never silently continues."""
    _require_mt5_package()
    if not mt5.initialize():
        code, description = mt5.last_error()
        raise Mt5ConnectionError(f"MT5 initialize() failed: [{code}] {description}")

    ok = mt5.login(config.login, password=config.password, server=config.server)
    if not ok:
        code, description = mt5.last_error()
        mt5.shutdown()
        raise Mt5ConnectionError(f"MT5 login() failed: [{code}] {description}")


@dataclass(frozen=True)
class Mt5AccountSummary:
    broker: str
    server: str
    login: int
    trade_mode: int
    is_demo: bool
    balance: float
    equity: float
    margin: float
    free_margin: float
    leverage: int
    currency: str


def get_account_info() -> Mt5AccountSummary:
    _require_mt5_package()
    info = mt5.account_info()
    if info is None:
        code, description = mt5.last_error()
        raise Mt5ConnectionError(f"account_info() returned None: [{code}] {description}")

    is_demo = info.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO
    return Mt5AccountSummary(
        broker=info.company,
        server=info.server,
        login=info.login,
        trade_mode=info.trade_mode,
        is_demo=is_demo,
        balance=info.balance,
        equity=info.equity,
        margin=info.margin,
        free_margin=info.margin_free,
        leverage=info.leverage,
        currency=info.currency,
    )


def assert_demo_or_raise(account: Mt5AccountSummary) -> None:
    """THE inviolable DEMO safety check (spec section 2).

    Compares the OFFICIAL `ACCOUNT_TRADE_MODE` attribute (already captured
    as `account.trade_mode`, read verbatim from `mt5.account_info()`)
    against the OFFICIAL `mt5.ACCOUNT_TRADE_MODE_DEMO` constant — never a
    proxy such as server name, account comment, symbol name, broker name,
    or an environment variable. `account.is_demo` was computed with this
    exact comparison in `get_account_info()`; this function re-checks it
    explicitly (never trusts a cached boolean from elsewhere) and aborts
    for ANY value that isn't literally DEMO — including
    ACCOUNT_TRADE_MODE_REAL, ACCOUNT_TRADE_MODE_CONTEST, or any future/
    unrecognized value. The error message never includes balance, login,
    server, or any other account detail — only that the account isn't demo.
    """
    if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise Mt5NotDemoError("Account is not a MetaTrader 5 DEMO account (ACCOUNT_TRADE_MODE != ACCOUNT_TRADE_MODE_DEMO).")


# Mirrors DEFAULT_MT5_SYMBOL_CANDIDATES in src/lib/execution/mt5SymbolMapper.ts
# EXACTLY for the three index entries (US500/NAS100/DAX) — kept in sync
# deliberately (verified by a cross-language consistency test, same
# pattern already used for compute_dataset_hash()), so the real-hardware
# smoke test's "then try indices" step (spec section 3) tries the SAME
# broker-specific name variants the rest of the app already knows about,
# rather than a second, drifting list. Never assumes a generic index name
# matches this broker — discover_symbol() below only ever confirms a
# candidate against the LIVE terminal's own symbol_info().
DEFAULT_INDEX_SYMBOL_CANDIDATES: dict[str, tuple[str, ...]] = {
    "US500": ("US500", "SPX500", "US500.cash", "SP500"),
    "NAS100": ("NAS100", "USTEC", "NAS100.cash", "US100"),
    "DAX": ("DAX", "GER40", "DE40", "GER30"),
}


def get_symbol_path(symbol: str) -> Optional[str]:
    """Returns the broker's OWN category path for an already-resolved
    broker-native symbol (e.g. "Crypto CFD\\BTCUSD", "MB Pro\\Forex\\EURUSD..."),
    via a single `mt5.symbol_info()` metadata read — never a guess from the
    symbol's name. Returns None if the symbol doesn't exist or has no path,
    exactly like every other probe in this module (never raises for "not
    found", only for a real API failure elsewhere)."""
    _require_mt5_package()
    info = mt5.symbol_info(symbol)
    if info is None:
        return None
    return info.path


def discover_symbol(candidates: Sequence[str]) -> Optional[str]:
    """Tries each candidate broker symbol name in order against the LIVE
    terminal's own `symbol_info()`. Returns the first that exists, or None
    — never invents/guesses a name outside the given candidate list."""
    _require_mt5_package()
    for name in candidates:
        info = mt5.symbol_info(name)
        if info is not None:
            return name
    return None


def list_all_symbols() -> list[dict]:
    """READ-ONLY full symbol listing (MT5 REAL DEMO — broker survey phase,
    spec section 2-4). Calls `mt5.symbols_get()` — a pure metadata read
    that never subscribes/enables a symbol for trading and never changes
    Market Watch state (unlike `mt5.symbol_select`, which this module
    never calls). Returns broker-reported fields verbatim, never a guess:
    `path` is the broker's OWN category grouping (e.g.
    "Forex\\Majors\\EURUSD", "Indices\\US500") — using it (see
    `categorize_symbols` below) means symbols are grouped by what the
    broker itself says they are, never by pattern-matching a name."""
    _require_mt5_package()
    symbols = mt5.symbols_get()
    if symbols is None:
        code, description = mt5.last_error()
        raise Mt5ConnectionError(f"symbols_get() failed: [{code}] {description}")
    return [
        {
            "name": s.name,
            "path": s.path,
            "description": s.description,
            "currency_base": s.currency_base,
            "currency_profit": s.currency_profit,
            "visible": bool(s.visible),
        }
        for s in symbols
    ]


def categorize_symbols(symbols: Sequence[dict]) -> dict[str, list[str]]:
    """Groups symbol names by the FIRST segment of the broker's own `path`
    (e.g. "Forex\\Majors\\EURUSD" -> group "Forex"), falling back to
    "Unclassified" when a symbol has no path. Never infers a category from
    the symbol's NAME — only from metadata the broker itself reports,
    since standard-looking names (EURUSD, XAUUSD) are never assumed to
    mean what they usually mean on a specific broker (spec section 4)."""
    groups: dict[str, list[str]] = {}
    for s in symbols:
        path = (s.get("path") or "").strip()
        group = path.split("\\")[0] if path else "Unclassified"
        groups.setdefault(group, []).append(s["name"])
    for names in groups.values():
        names.sort()
    return groups


def resolve_canonical_symbol(root: str, all_symbols: Sequence[dict]) -> dict:
    """MT5 SYMBOL RESOLUTION (read-only) — resolves a canonical instrument
    root (e.g. "EURUSD") to THIS broker's actual native symbol name, using
    only the LIVE symbol list's own `name`/`path` fields (from
    `list_all_symbols()`) — never a hardcoded per-broker suffix/prefix
    guess. A broker's canonical DISPLAY name (what its own UI shows) can
    still differ from the exact API `name` MT5 reports (a decorated
    variant like "EURUSD.pro"/"EURUSDm"/"EURUSD_i"), which is exactly why
    `discover_symbol([root])` — an EXACT match only — can legitimately
    report SYMBOL_NOT_FOUND even when the instrument is genuinely
    available under a decorated name.

    Matching tiers, in order (first non-empty tier wins, deterministic):
      1. EXACT name match (case-insensitive).
      2. name STARTS WITH root — the dominant broker convention for a
         suffixed variant (EURUSD.pro, EURUSDm, EURUSD_i, ...).
      3. root is a SUBSTRING of name — a last-resort fallback for a
         prefixed or otherwise decorated name (e.g. "#EURUSD").
    Within the winning tier, candidates are sorted by (name length, name)
    for a stable, reproducible pick — and EVERY candidate at that tier is
    reported (not just the winner), so an ambiguous broker naming scheme
    stays visible instead of being silently resolved one way. The
    resolved symbol's own `path` is carried through too, so the result
    can be audited against the broker's own category metadata rather
    than trusted blindly on name alone.
    """
    root_upper = root.upper()

    def _tier_candidates() -> tuple[Optional[str], list[dict]]:
        exact = [s for s in all_symbols if s["name"].upper() == root_upper]
        if exact:
            return "exact", exact
        starts = sorted((s for s in all_symbols if s["name"].upper().startswith(root_upper)), key=lambda s: (len(s["name"]), s["name"]))
        if starts:
            return "startswith", starts
        contains = sorted((s for s in all_symbols if root_upper in s["name"].upper()), key=lambda s: (len(s["name"]), s["name"]))
        if contains:
            return "contains", contains
        return None, []

    tier, candidates = _tier_candidates()
    if not candidates:
        return {"root": root, "resolved": None, "mt5_symbol": None, "tier": None, "path": None, "candidates": []}

    winner = candidates[0]
    return {
        "root": root,
        "resolved": winner["name"],
        "mt5_symbol": winner["name"],
        "tier": tier,
        "path": winner.get("path"),
        "candidates": [{"name": c["name"], "path": c.get("path")} for c in candidates],
    }


_SUPPORTED_TIMEFRAMES = ("H1", "H4", "D1")


def _timeframe_constant(timeframe: str) -> int:
    _require_mt5_package()
    if timeframe not in _SUPPORTED_TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {timeframe!r} (supported: {_SUPPORTED_TIMEFRAMES})")
    mapping = {"H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4, "D1": mt5.TIMEFRAME_D1}
    return mapping[timeframe]


def _iso_ms_utc(ts) -> str:
    """Formats a UTC timestamp exactly like JavaScript's `Date.prototype.toISOString()`
    (`YYYY-MM-DDTHH:MM:SS.sssZ`, always 3 millisecond digits, always "Z") —
    kept in sync deliberately with computeDatasetHash() on the TypeScript
    side (src/lib/research/researchDataset.ts) so the hash this module
    computes over the SAME rows is directly comparable, not just
    independently deterministic. MT5 bar timestamps are always on exact
    second boundaries for H1/H4/D1, so milliseconds are always "000" here,
    but the format is written generically rather than assuming that."""
    dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + f".{dt.microsecond // 1000:03d}Z"


def _rates_to_bars(rates) -> list[dict]:
    """Shared conversion from the raw MT5 `rates` structured array (however
    it was fetched — `copy_rates_range`, `copy_rates_from`, or
    `copy_rates_from_pos`) to this module's canonical bar-dict shape. Never
    fabricates a row — a caller with an empty/None `rates` handles that
    itself, this function just converts whatever real rows it's given."""
    bars = []
    for r in rates:
        bars.append(
            {
                "timestamp": _iso_ms_utc(r["time"]),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": float(r["tick_volume"]),
                "tick_volume": int(r["tick_volume"]),
                "spread": int(r["spread"]),
                "real_volume": int(r["real_volume"]),
            }
        )
    return bars


def get_historical_rates(symbol: str, timeframe: str, start: datetime, end: datetime) -> list[dict]:
    """READ-ONLY historical OHLCV, native MT5 timeframe (no resampling).

    Returns a list of dicts with the canonical timestamp/open/high/low/
    close/volume fields (volume = tick_volume — see docs/mt5-data-connector.md
    for why real_volume is not used as the canonical field) plus the raw
    tick_volume/spread/real_volume MT5 also reports. Never fabricates a
    row; an empty/unavailable range raises Mt5ConnectionError rather than
    silently returning partial or synthetic data.
    """
    _require_mt5_package()
    tf = _timeframe_constant(timeframe)
    rates = mt5.copy_rates_range(symbol, tf, start, end)
    if rates is None:
        code, description = mt5.last_error()
        raise Mt5ConnectionError(f"copy_rates_range() failed for {symbol}/{timeframe}: [{code}] {description}")
    return _rates_to_bars(rates)


# Safely before any real broker's actual history — used only as the
# starting point for probe_earliest_bar()'s `copy_rates_from`, never as a
# claim that data exists there.
_EPOCH_FLOOR = datetime(1990, 1, 1, tzinfo=timezone.utc)


def probe_earliest_bar(symbol: str, timeframe: str) -> Optional[dict]:
    """MT5 HISTORICAL DISCOVERY (read-only) — finds the SINGLE earliest bar
    this broker's terminal actually has for (symbol, timeframe), transferring
    only ONE row rather than the broker's entire history. Uses
    `mt5.copy_rates_from(symbol, tf, _EPOCH_FLOOR, 1)`: MT5 returns the
    first `count` bars AT OR AFTER `date_from`, in ascending order — since
    `_EPOCH_FLOOR` predates any real broker's history, the single bar
    returned is genuinely the earliest one available. Returns None if the
    broker reports no history at all for this symbol/timeframe (never
    raises for "no data" — only for a real API failure)."""
    _require_mt5_package()
    tf = _timeframe_constant(timeframe)
    rates = mt5.copy_rates_from(symbol, tf, _EPOCH_FLOOR, 1)
    if rates is None or len(rates) == 0:
        return None
    return _rates_to_bars(rates)[0]


def probe_latest_bar(symbol: str, timeframe: str) -> Optional[dict]:
    """Same idea as `probe_earliest_bar`, but for the single MOST RECENT
    bar: `mt5.copy_rates_from_pos(symbol, tf, 0, 1)` — position 0 is
    always the latest closed/forming bar. One-row transfer."""
    _require_mt5_package()
    tf = _timeframe_constant(timeframe)
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, 1)
    if rates is None or len(rates) == 0:
        return None
    return _rates_to_bars(rates)[0]


def get_recent_bars(symbol: str, timeframe: str, max_rows: int) -> list[dict]:
    """MT5 HISTORICAL DISCOVERY (read-only) — the bounded VALIDATION SAMPLE:
    up to `max_rows` most recent bars via `mt5.copy_rates_from_pos(symbol,
    tf, 0, max_rows)`. Deliberately NOT the full practical range from
    `probe_earliest_bar()` — downloading a broker's entire history just to
    decide whether it's worth ingesting is exactly what this phase avoids
    (see spec: "Do not download huge datasets unnecessarily"). Returns
    however many bars the broker actually has, up to `max_rows` — never
    pads to reach that count."""
    _require_mt5_package()
    tf = _timeframe_constant(timeframe)
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, max_rows)
    if rates is None:
        code, description = mt5.last_error()
        raise Mt5ConnectionError(f"copy_rates_from_pos() failed for {symbol}/{timeframe}: [{code}] {description}")
    return _rates_to_bars(rates)


def estimate_expected_candle_count(earliest_iso: str, latest_iso: str, timeframe: str) -> int:
    """Upper-bound ESTIMATE of how many candles the full practical range
    (earliest_iso to latest_iso, from the two cheap probes) would contain
    IF there were no gaps at all — `round(span / step) + 1`, the exact same
    formula `coverage.ts`'s `coveragePct` uses for its own "expected if no
    gaps" denominator. This is explicitly an estimate, never an actual
    count — the real count can only be known by downloading the full
    range, which this discovery phase deliberately does not do."""
    if timeframe not in _TIMEFRAME_SECONDS:
        raise ValueError(f"Unsupported timeframe: {timeframe!r} (supported: {tuple(_TIMEFRAME_SECONDS)})")
    earliest_dt = datetime.strptime(earliest_iso, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    latest_dt = datetime.strptime(latest_iso, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    step = _TIMEFRAME_SECONDS[timeframe]
    return round((latest_dt - earliest_dt).total_seconds() / step) + 1


def compute_sample_coverage_pct(row_count: int, first_iso: str, last_iso: str, timeframe: str) -> Optional[float]:
    """Same `coveragePct` formula as `coverage.ts`'s `computeMarketDataCoverage`
    (`rowCount / expected-if-no-gaps * 100`), applied to the VALIDATION
    SAMPLE (not the full practical range)."""
    if row_count == 0:
        return None
    expected = estimate_expected_candle_count(first_iso, last_iso, timeframe)
    return 100.0 * row_count / expected if expected > 0 else None


def _is_finite_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_one_bar(bar: dict) -> list[str]:
    """Same rules as `validateOneCandle()` in
    src/lib/marketData/candleValidation.ts, applied field-by-field so the
    two are trivially diffable against each other: open/high/low/close
    must be finite AND strictly positive; volume must be finite AND >= 0;
    the high/low/open/close relationships are only checked once every
    price is confirmed finite (a NaN would make every comparison silently
    false otherwise)."""
    reasons: list[str] = []
    for name in ("open", "high", "low", "close"):
        value = bar[name]
        if not (_is_finite_number(value) and value > 0):
            reasons.append(f"{name} debe ser un número finito positivo (recibido: {value})")
    volume = bar["volume"]
    if not (_is_finite_number(volume) and volume >= 0):
        reasons.append(f"volume debe ser un número finito >= 0 (recibido: {volume})")

    prices_finite = all(_is_finite_number(bar[k]) for k in ("open", "high", "low", "close"))
    if prices_finite:
        o, h, low, c = bar["open"], bar["high"], bar["low"], bar["close"]
        if not (h >= low):
            reasons.append(f"high ({h}) debe ser >= low ({low})")
        if not (h >= o):
            reasons.append(f"high ({h}) debe ser >= open ({o})")
        if not (h >= c):
            reasons.append(f"high ({h}) debe ser >= close ({c})")
        if not (low <= o):
            reasons.append(f"low ({low}) debe ser <= open ({o})")
        if not (low <= c):
            reasons.append(f"low ({low}) debe ser <= close ({c})")
    return reasons


def validate_ohlc_bars(bars: Sequence[dict]) -> dict:
    """MT5 HISTORICAL DISCOVERY (read-only) — reject-not-score OHLC
    validation over a bar sample, mirroring `validateCandleBatch()`
    (candleValidation.ts) field-for-field. Returns
    `{"valid": [...], "invalid": [{"bar": ..., "reasons": [...]}, ...]}` —
    invalid bars are reported, never silently dropped from the report
    (they ARE dropped from the hash — see `mt5_historical_discovery.py`,
    which mirrors the persisted-dataset convention of only ever hashing
    rows that passed validation)."""
    valid: list[dict] = []
    invalid: list[dict] = []
    for bar in bars:
        reasons = _validate_one_bar(bar)
        if reasons:
            invalid.append({"bar": bar, "reasons": reasons})
        else:
            valid.append(bar)
    return {"valid": valid, "invalid": invalid}


_TIMEFRAME_SECONDS = {"H1": 3600, "H4": 4 * 3600, "D1": 24 * 3600}


def count_duplicates(bars: Sequence[dict]) -> int:
    """Counts bars sharing an exact timestamp with an already-seen bar,
    walking the (chronologically sorted) sequence — mirrors the concept
    used by the TypeScript side's candle validator. Never de-duplicates
    anything itself, only counts, purely for the smoke test's diagnostic
    output (spec section 3)."""
    seen: set[str] = set()
    duplicates = 0
    for b in sorted(bars, key=lambda b: b["timestamp"]):
        ts = b["timestamp"]
        if ts in seen:
            duplicates += 1
        else:
            seen.add(ts)
    return duplicates


def classify_gap(after_iso: str, before_iso: str, timeframe: str = "H1") -> str:
    """Best-effort classification of a gap between two consecutive bars,
    for human review (MT5 REAL DEMO — broker survey phase, spec section 5:
    "determina si son huecos esperables por horario/cierre del mercado o
    anomalías"). This is a HEURISTIC, not a certainty — exact session
    hours are broker- and instrument-specific, and this function has no
    access to the broker's real trading-hours schedule (MT5 exposes that
    per-symbol via `symbol_info().session_*`, which this read-only survey
    does not call). Treat "unclassified" as "needs a human look", never
    as "confirmed anomaly".

    - "weekend_close": the gap starts Friday (or the weekend itself) and
      ends Sunday or Monday — the ordinary weekly market closure.
    - "daily_session_break": a short gap (<=3 hours) that isn't a weekend
      closure — the common nightly quote-rollover/settlement pause many
      brokers apply to CFD/index quoting.
    - "unclassified": matches neither pattern — could be a real data gap,
      a longer maintenance window, or a holiday closure; worth a manual
      check against the broker's own session calendar.

    `timeframe` matters for the Friday boundary specifically: H1/H4 bars
    carry a real hour-of-day, so a Friday gap is only treated as the
    weekly close once it starts in the afternoon/evening (`hour >= 12`) —
    an early-Friday gap of that shape would be unusual and stays
    "unclassified" for a human look. D1 bars, by construction, are always
    stamped at hour 00:00 — requiring `hour >= 12` there would silently
    reject EVERY ordinary weekly closure a D1 series has (a real bug this
    fixes: it mislabeled the routine Friday->Monday weekly gap that
    appears once a week, every week, in D1 data as "unclassified"), so for
    D1 the Friday boundary is accepted regardless of hour.
    """
    after_dt = datetime.strptime(after_iso, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    before_dt = datetime.strptime(before_iso, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    duration_hours = (before_dt - after_dt).total_seconds() / 3600

    after_weekday = after_dt.weekday()  # Monday=0 ... Sunday=6
    before_weekday = before_dt.weekday()

    friday_boundary_ok = after_weekday == 4 and (timeframe == "D1" or after_dt.hour >= 12)
    starts_weekend = friday_boundary_ok or after_weekday in (5, 6)
    ends_after_weekend = before_weekday in (6, 0)  # Sunday or Monday
    if starts_weekend and ends_after_weekend and duration_hours >= 12:
        return "weekend_close"

    if duration_hours <= 3:
        return "daily_session_break"

    return "unclassified"


def list_gap_intervals(bars: Sequence[dict], timeframe: str) -> list[dict]:
    """Same gap detection as `count_gaps()`, but returns each interval's
    boundaries, missing-candle count, and a best-effort `classify_gap()`
    label instead of only a total — so a human can see WHICH gaps are
    ordinary market structure vs worth a closer look. Never fills a gap,
    never invents a classification beyond the heuristic documented on
    `classify_gap()`."""
    if timeframe not in _TIMEFRAME_SECONDS:
        raise ValueError(f"Unsupported timeframe: {timeframe!r} (supported: {tuple(_TIMEFRAME_SECONDS)})")
    step = _TIMEFRAME_SECONDS[timeframe]
    ordered = sorted({b["timestamp"] for b in bars})
    intervals = []
    for prev_ts, curr_ts in zip(ordered, ordered[1:]):
        prev_dt = datetime.strptime(prev_ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        curr_dt = datetime.strptime(curr_ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        delta_seconds = (curr_dt - prev_dt).total_seconds()
        missing = round(delta_seconds / step) - 1
        if missing > 0:
            intervals.append({"after": prev_ts, "before": curr_ts, "missing": missing, "classification": classify_gap(prev_ts, curr_ts, timeframe)})
    return intervals


def count_gaps(bars: Sequence[dict], timeframe: str) -> int:
    """Counts GAP INTERVALS (not individual missing candles) between
    consecutive, chronologically sorted, de-duplicated timestamps, given
    the timeframe's native spacing — one skipped stretch of missing bars
    counts once, matching the convention `ResearchDataset.gapCount` already
    uses on the TypeScript side (`coverage.gaps.length`, see
    src/lib/marketData/coverage.ts). Never fills a gap, only counts it."""
    return len(list_gap_intervals(bars, timeframe))


def now_iso_utc() -> str:
    """Public wrapper around `_iso_ms_utc()` for callers (e.g.
    `mt5_historical_discovery.py`) that need a "retrieved at" timestamp in
    the SAME format as every bar timestamp this module produces, without
    reaching into a private helper."""
    return _iso_ms_utc(datetime.now(tz=timezone.utc).timestamp())


def shutdown() -> None:
    if mt5 is not None:
        mt5.shutdown()


def account_type_label(trade_mode: int) -> Optional[str]:
    """MT5 REAL BRIDGE (read-only) — maps the OFFICIAL `ACCOUNT_TRADE_MODE`
    integer to the exact `"DEMO" | "LIVE" | null` vocabulary the TypeScript
    side's `Mt5AccountInfo.accountType` expects (src/lib/execution/types.ts).
    Any trade_mode that isn't literally DEMO or REAL (e.g. CONTEST, or a
    future/unrecognized value) maps to `None` — never guessed as either,
    consistent with `assert_demo_or_raise()`'s own "anything but DEMO is
    rejected" stance. This never itself decides demo-vs-live authorization
    — that's still `assert_demo_or_raise()` / the TypeScript-side
    `verifyAccountIsDemo()`'s job; this is purely a label for display.

    Uses the ENUM_ACCOUNT_TRADE_MODE integer values directly (0=DEMO,
    2=REAL — stable, official MT5 terminal API constants, identical to
    `mt5.ACCOUNT_TRADE_MODE_DEMO`/`mt5.ACCOUNT_TRADE_MODE_REAL` whenever the
    real package is available) rather than requiring the live
    `MetaTrader5` package just to label an already-obtained integer — so
    this one function stays unit-testable without a real MT5 terminal,
    unlike every other function in this module that touches `mt5.*`."""
    if trade_mode == 0:  # ACCOUNT_TRADE_MODE_DEMO
        return "DEMO"
    if trade_mode == 2:  # ACCOUNT_TRADE_MODE_REAL
        return "LIVE"
    return None


def is_initialized() -> bool:
    """MT5 REAL BRIDGE (read-only) — a cheap liveness check for callers
    (the sidecar's `/mt5/status` endpoint) that need to know "is a
    terminal session currently open" without re-reading full account info.
    `mt5.terminal_info()` returns a real struct only while `initialize()`
    has succeeded and `shutdown()` hasn't been called since; returns None
    once shut down or if the package itself isn't available. Never raises
    — a liveness probe that could itself fail defeats its purpose."""
    if mt5 is None:
        return False
    return mt5.terminal_info() is not None


def get_symbol_spec(symbol: str) -> Optional[dict]:
    """MT5 REAL BRIDGE (read-only) — the broker's own trading-size/tick
    metadata for an already-resolved broker-native symbol, via a single
    `mt5.symbol_info()` read (the SAME call `get_symbol_path()` already
    uses — never `symbol_select`, never subscribes the symbol to Market
    Watch). Returns None if the symbol doesn't exist, exactly like every
    other probe in this module. Field names match the sidecar's
    `Mt5SymbolSpec` JSON contract (src/lib/execution/types.ts) directly so
    the sidecar layer only has to pass this dict through unchanged."""
    _require_mt5_package()
    info = mt5.symbol_info(symbol)
    if info is None:
        return None
    return {
        "symbol": symbol,
        "tickSize": float(info.trade_tick_size),
        "tickValue": float(info.trade_tick_value),
        "contractSize": float(info.trade_contract_size),
        "volumeStep": float(info.volume_step),
        "volumeMin": float(info.volume_min),
        "volumeMax": float(info.volume_max),
        "digits": int(info.digits),
    }


def get_quote(symbol: str) -> Optional[dict]:
    """MT5 REAL BRIDGE (read-only) — the broker's last known bid/ask/last
    for an already-resolved broker-native symbol, via a single
    `mt5.symbol_info_tick()` read — a pure quote read, never a
    subscription/order call. Returns None if the symbol doesn't exist or
    the terminal has no tick for it yet, never fabricated. `last` is 0 for
    most FX/CFD symbols (MT5 doesn't report a genuine "last traded price"
    for quote-driven instruments) — passed through exactly as the broker
    reports it, never substituted with mid-price or any other guess."""
    _require_mt5_package()
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return None
    return {
        "symbol": symbol,
        "bid": float(tick.bid),
        "ask": float(tick.ask),
        "spread": float(tick.ask) - float(tick.bid),
        "last": float(tick.last) if tick.last else None,
        "timestamp": _iso_ms_utc(tick.time),
    }


def _js_number_str(x: float) -> str:
    """Formats a number exactly like JavaScript's `Number.prototype.toString()`
    — critically, a whole-number float like `100.0` becomes `"100"`, never
    `"100.0"`. Python's `repr()`/`str()` for a float already matches JS's
    shortest-round-trip representation for every NON-whole value (both
    languages use an equivalent shortest-round-trip algorithm), so this is
    the ONE necessary correction, not a general reimplementation of
    float-to-string. Volume fields (tick counts) are whole numbers far
    more often than price fields, which is exactly where this would
    otherwise silently produce a hash that could never match the
    TypeScript side's for the identical dataset."""
    if float(x).is_integer():
        return str(int(x))
    return repr(float(x))


def compute_dataset_hash(bars: Sequence[dict]) -> str:
    """Same convention as the TypeScript side's `computeDatasetHash()`
    (src/lib/research/researchDataset.ts): rows sorted chronologically,
    `timestamp|open|high|low|close|volume` per line — numbers formatted via
    `_js_number_str()` so they byte-match JS's `.toString()`, never
    Python's own float `str()`/`repr()` directly (see that function's own
    docstring for why) — lines joined with "\\n", SHA-256 hex digest over
    the result. Deliberately documented and frozen here BEFORE any real
    dataset is hashed with it — see spec section 9. The SAME bars, hashed
    on either side of the pipeline, MUST produce the SAME hash — verified
    by a byte-for-byte comparison test (see docs/mt5-data-connector.md).
    """
    ordered = sorted(bars, key=lambda b: b["timestamp"])
    lines = [f"{b['timestamp']}|{_js_number_str(b['open'])}|{_js_number_str(b['high'])}|{_js_number_str(b['low'])}|{_js_number_str(b['close'])}|{_js_number_str(b['volume'])}" for b in ordered]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
