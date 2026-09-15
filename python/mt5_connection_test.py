#!/usr/bin/env python3
"""
MT5 DEMO CONNECTION TEST

A standalone, READ-ONLY smoke test for the MT5 Data Connector. Confirms
credentials load safely, the terminal connects, the account is genuinely
DEMO, and a small real historical download + validation + hash round-trip
works end to end.

This script NEVER:
  - opens a position
  - closes a position
  - modifies a position
  - sends an order
  - modifies stops
  - modifies the account

Before anything else, it checks ENABLE_DEMO_EXECUTION — if that's "true",
it aborts immediately, printing nothing but the abort reason: this smoke
test is READ-ONLY by design, even against a genuine DEMO account.

It reads MT5_LOGIN / MT5_PASSWORD / MT5_SERVER from `.env.local` in the
repository root (falling back to already-exported environment variables —
`.env.local` is optional, never required, never committed). Symbol
discovery tries EURUSD/GBPUSD/USDJPY/XAUUSD first, then the three indices
(US500/NAS100/DAX) via the same broker-specific candidate list the app's
TypeScript symbol mapper uses — unless `--symbol` pins an exact one. It
prints only safe diagnostic information: account mode, server, trade
mode, a masked login, demo balance/equity/currency, the discovered
symbol/timeframe/row count/date range, OHLC validation, duplicate count,
gap count, and the dataset hash. It never prints the password or any
credential in full.

Usage:
    python3 python/mt5_precheck.py            # run this first
    python3 python/mt5_connection_test.py [--symbol EURUSD] [--rows 1000]
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mt5_data_connector as mt5c  # noqa: E402
from mt5_dotenv import load_dotenv_local  # noqa: E402

# Discovery order for the "MT5 REAL DEMO DATA INGESTION SMOKE TEST" phase
# (spec section 3): Forex majors + one metal first, then the three indices
# via the SAME candidate list the app's TypeScript symbol mapper already
# uses (DEFAULT_INDEX_SYMBOL_CANDIDATES, kept in sync with
# src/lib/execution/mt5SymbolMapper.ts — verified by a cross-language
# consistency test). Each entry tries its candidates in order; the first
# one that exists on THIS broker's live terminal wins. Never assumes a
# generic name (e.g. "US500") matches this specific broker.
_DEFAULT_DISCOVERY_CANDIDATES: list[tuple[str, list[str]]] = [
    ("EURUSD", ["EURUSD", "EURUSDm", "EURUSD.a"]),
    ("GBPUSD", ["GBPUSD", "GBPUSDm", "GBPUSD.a"]),
    ("USDJPY", ["USDJPY", "USDJPYm", "USDJPY.a"]),
    ("XAUUSD", ["XAUUSD", "GOLD", "XAUUSDm"]),
    *[(label, list(candidates)) for label, candidates in mt5c.DEFAULT_INDEX_SYMBOL_CANDIDATES.items()],
]


def _mask_login(login: int) -> str:
    """Same masking convention as the TypeScript side's maskIdentifier() — only the last 2 digits are ever shown."""
    s = str(login)
    if len(s) <= 2:
        return "•" * len(s)
    return "•" * (len(s) - 2) + s[-2:]


def main() -> int:
    parser = argparse.ArgumentParser(description="MT5 DEMO CONNECTION TEST — read-only smoke test.")
    parser.add_argument("--symbol", default=None, help="Symbol to test (default: first available candidate from a short built-in list)")
    parser.add_argument("--rows", type=int, default=1000, help="Number of H1 bars to download (default 1000)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_local(repo_root / ".env.local")

    print("=== MT5 DEMO CONNECTION TEST (read-only) ===")

    # Spec section 5 — checked FIRST, before even reading credentials: this
    # smoke test stays READ-ONLY even though the account is DEMO, and
    # refuses to run at all if the execution kill switch is misconfigured.
    try:
        mt5c.assert_execution_disabled_or_raise()
    except mt5c.Mt5ExecutionEnabledError as exc:
        print(f"[MT5] {exc}")
        return 1

    try:
        config = mt5c.get_mt5_config()
    except mt5c.Mt5ConfigError as exc:
        print(f"[MT5] {exc}")
        return 1

    print(f"[MT5] Login: {_mask_login(config.login)}")
    print(f"[MT5] Server: {config.server}")

    try:
        mt5c.initialize_and_login(config)
    except mt5c.Mt5ConnectionError as exc:
        print(f"[MT5] Connection failed: {exc}")
        return 1

    try:
        print("[MT5] Connecting to demo server")
        account = mt5c.get_account_info()
        print(f"[MT5] Account mode: {'DEMO' if account.is_demo else 'NOT DEMO'} (trade_mode={account.trade_mode})")

        try:
            mt5c.assert_demo_or_raise(account)
        except mt5c.Mt5NotDemoError as exc:
            print(f"[MT5] {exc}")
            print("[MT5] Aborting — no data will be downloaded for a non-demo account.")
            return 1

        print("[MT5] Demo account verified")
        print(f"[MT5] Server: {account.server}")
        print(f"[MT5] Trade mode: {account.trade_mode} (ACCOUNT_TRADE_MODE_DEMO)")
        print(f"[MT5] Balance: {account.balance} {account.currency}")
        print(f"[MT5] Equity: {account.equity} {account.currency}")
        print(f"[MT5] Broker: {account.broker}")

        if args.symbol:
            discovery_plan = [(args.symbol, [args.symbol])]
        else:
            discovery_plan = _DEFAULT_DISCOVERY_CANDIDATES

        symbol: Optional[str] = None
        discovered_label: Optional[str] = None
        for label, candidates in discovery_plan:
            found = mt5c.discover_symbol(candidates)
            if found is not None:
                symbol, discovered_label = found, label
                break
            print(f"[MT5] Symbol not found on this broker for {label} (tried: {candidates})")

        if symbol is None:
            print("[MT5] No candidate symbol found on this broker across the full discovery list — cannot proceed with the download step.")
            return 1
        print(f"[MT5] Symbol discovered: {symbol} (target: {discovered_label})")

        end = datetime.now(tz=timezone.utc)
        start = end - timedelta(hours=args.rows + 24)
        bars = mt5c.get_historical_rates(symbol, "H1", start, end)
        bars = bars[-args.rows :] if len(bars) > args.rows else bars
        print(f"[MT5] Downloaded {len(bars)} H1 bars")

        if not bars:
            print("[MT5] No bars returned — nothing to validate or hash.")
            return 1

        invalid = [b for b in bars if not (b["high"] >= max(b["open"], b["close"]) and b["low"] <= min(b["open"], b["close"]) and b["high"] >= b["low"])]
        print(f"[MT5] OHLC validation: {len(bars) - len(invalid)}/{len(bars)} bars valid ({len(invalid)} invalid)")

        duplicate_count = mt5c.count_duplicates(bars)
        gap_count = mt5c.count_gaps(bars, "H1")
        print(f"[MT5] Duplicate count: {duplicate_count}")
        print(f"[MT5] Gap count: {gap_count}")

        print(f"[MT5] Date range: {bars[0]['timestamp']} -> {bars[-1]['timestamp']}")

        dataset_hash = mt5c.compute_dataset_hash(bars)
        print(f"[MT5] Dataset hash: {dataset_hash}")

        print("[MT5] Connection test PASSED — read-only, no order was ever sent.")
        return 0
    finally:
        mt5c.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
