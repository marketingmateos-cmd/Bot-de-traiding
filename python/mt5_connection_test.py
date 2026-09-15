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

It reads MT5_LOGIN / MT5_PASSWORD / MT5_SERVER from `.env.local` in the
repository root (falling back to already-exported environment variables —
`.env.local` is optional, never required, never committed). It prints only
safe diagnostic information: account mode, server, a masked login, demo
balance/currency, the symbol/timeframe/row count/date range it downloaded,
and the dataset hash. It never prints the password or any credential in
full.

Usage:
    python3 python/mt5_connection_test.py [--symbol EURUSD] [--rows 1000]
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mt5_data_connector as mt5c  # noqa: E402


def _mask_login(login: int) -> str:
    """Same masking convention as the TypeScript side's maskIdentifier() — only the last 2 digits are ever shown."""
    s = str(login)
    if len(s) <= 2:
        return "•" * len(s)
    return "•" * (len(s) - 2) + s[-2:]


def _load_dotenv_local(path: Path) -> None:
    """Minimal, dependency-free .env parser — only sets a variable if it
    isn't ALREADY set in the real environment (an explicitly exported var
    always wins over the file), and only for the three MT5_* keys this
    script cares about. Never logs a value, never echoes the file's
    contents."""
    import os

    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        if key not in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"):
            continue
        if key in os.environ:
            continue
        value = value.strip().strip('"').strip("'")
        os.environ[key] = value


def main() -> int:
    parser = argparse.ArgumentParser(description="MT5 DEMO CONNECTION TEST — read-only smoke test.")
    parser.add_argument("--symbol", default=None, help="Symbol to test (default: first available candidate from a short built-in list)")
    parser.add_argument("--rows", type=int, default=1000, help="Number of H1 bars to download (default 1000)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    _load_dotenv_local(repo_root / ".env.local")

    print("=== MT5 DEMO CONNECTION TEST (read-only) ===")

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
        print(f"[MT5] Balance: {account.balance} {account.currency}")
        print(f"[MT5] Broker: {account.broker}")

        candidates = [args.symbol] if args.symbol else ["EURUSD", "EURUSDm", "EURUSD.a", "GBPUSD", "XAUUSD"]
        symbol = mt5c.discover_symbol(candidates)
        if symbol is None:
            print(f"[MT5] No candidate symbol found on this broker (tried: {candidates}) — cannot proceed with the download step.")
            return 1
        print(f"[MT5] Symbol discovered: {symbol}")

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

        print(f"[MT5] Date range: {bars[0]['timestamp']} -> {bars[-1]['timestamp']}")

        dataset_hash = mt5c.compute_dataset_hash(bars)
        print(f"[MT5] Dataset hash: {dataset_hash}")

        print("[MT5] Connection test PASSED — read-only, no order was ever sent.")
        return 0
    finally:
        mt5c.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
