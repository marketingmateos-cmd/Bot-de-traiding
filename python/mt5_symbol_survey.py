#!/usr/bin/env python3
"""
MT5 REAL DEMO — BROKER SYMBOL SURVEY (read-only)

A standalone, READ-ONLY diagnostic for the MT5 Data Connector's "broker
survey" phase: lists EVERY symbol this broker's terminal actually
reports (never assumes a standard name like EURUSD/XAUUSD exists — see
`docs/mt5-data-connector.md`), grouped by the BROKER'S OWN category
metadata (`symbol_info().path`, never a name-pattern guess), and — for
one chosen symbol/timeframe — breaks down each detected gap with a
best-effort classification (ordinary weekend closure / daily session
break / needs a manual look).

This script NEVER:
  - opens, closes, or modifies a position
  - sends an order
  - modifies stops or the account
  - calls `mt5.symbol_select` (would change Market Watch visibility —
    not needed for `symbols_get` or `copy_rates_range`)

Like `mt5_connection_test.py`, it checks `ENABLE_DEMO_EXECUTION` FIRST
and aborts if it's "true" — this survey stays READ-ONLY even against a
genuine DEMO account. It downloads at most `--rows` bars for the gap
analysis (default 1000, same diagnostic scale as the connection test) —
this is NOT a bulk historical ingestion.

Usage:
    python3 python/mt5_symbol_survey.py [--symbol US500] [--timeframe H1] [--rows 1000] [--limit 40]
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

# Same discovery order as mt5_connection_test.py — majors + metal first,
# then indices via the candidate list shared with mt5SymbolMapper.ts.
_DEFAULT_DISCOVERY_CANDIDATES: list[tuple[str, list[str]]] = [
    ("EURUSD", ["EURUSD", "EURUSDm", "EURUSD.a"]),
    ("GBPUSD", ["GBPUSD", "GBPUSDm", "GBPUSD.a"]),
    ("USDJPY", ["USDJPY", "USDJPYm", "USDJPY.a"]),
    ("XAUUSD", ["XAUUSD", "GOLD", "XAUUSDm"]),
    *[(label, list(candidates)) for label, candidates in mt5c.DEFAULT_INDEX_SYMBOL_CANDIDATES.items()],
]


def _mask_login(login: int) -> str:
    s = str(login)
    if len(s) <= 2:
        return "•" * len(s)
    return "•" * (len(s) - 2) + s[-2:]


def main() -> int:
    parser = argparse.ArgumentParser(description="MT5 broker symbol survey + gap classification — read-only.")
    parser.add_argument("--symbol", default=None, help="Symbol to run the gap analysis on (default: same discovery order as the connection test)")
    parser.add_argument("--timeframe", default="H1", choices=["H1", "H4", "D1"], help="Timeframe for the gap analysis (default H1)")
    parser.add_argument("--rows", type=int, default=1000, help="Max bars to download for the gap analysis (default 1000 — diagnostic scale, not a bulk import)")
    parser.add_argument("--limit", type=int, default=40, help="Max symbol names printed per category (default 40)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_local(repo_root / ".env.local")

    print("=== MT5 REAL DEMO — BROKER SYMBOL SURVEY (read-only) ===")

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
        account = mt5c.get_account_info()
        try:
            mt5c.assert_demo_or_raise(account)
        except mt5c.Mt5NotDemoError as exc:
            print(f"[MT5] {exc}")
            print("[MT5] Aborting — no symbol data will be read for a non-demo account.")
            return 1
        print("[MT5] Demo account verified")
        print(f"[MT5] Broker: {account.broker}")

        print("\n--- Symbol survey (broker's own category metadata) ---")
        symbols = mt5c.list_all_symbols()
        print(f"[MT5] Total symbols reported by this broker: {len(symbols)}")
        groups = mt5c.categorize_symbols(symbols)
        for group in sorted(groups.keys()):
            names = groups[group]
            shown = names[: args.limit]
            more = len(names) - len(shown)
            suffix = f" ... and {more} more" if more > 0 else ""
            print(f"[MT5] {group}: {len(names)} symbol(s) — {', '.join(shown)}{suffix}")

        print("\n--- Gap analysis ---")
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

        if symbol is None:
            print("[MT5] No candidate symbol found on this broker — skipping gap analysis.")
            return 1
        print(f"[MT5] Symbol for gap analysis: {symbol} (target: {discovered_label})")

        end = datetime.now(tz=timezone.utc)
        step_hours = {"H1": 1, "H4": 4, "D1": 24}[args.timeframe]
        start = end - timedelta(hours=args.rows * step_hours + 24)
        bars = mt5c.get_historical_rates(symbol, args.timeframe, start, end)
        bars = bars[-args.rows :] if len(bars) > args.rows else bars
        print(f"[MT5] Downloaded {len(bars)} {args.timeframe} bars for gap analysis")

        if not bars:
            print("[MT5] No bars returned — nothing to analyze.")
            return 1

        gaps = mt5c.list_gap_intervals(bars, args.timeframe)
        print(f"[MT5] Gap count: {len(gaps)}")

        tally: dict[str, int] = {}
        for gap in gaps:
            tally[gap["classification"]] = tally.get(gap["classification"], 0) + 1
            print(f"[MT5] Gap: {gap['after']} -> {gap['before']} (missing={gap['missing']}, classification={gap['classification']})")

        print(f"[MT5] Gap classification summary: {tally}")
        print("\n[MT5] Symbol survey PASSED — read-only, no order was ever sent.")
        return 0
    finally:
        mt5c.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
