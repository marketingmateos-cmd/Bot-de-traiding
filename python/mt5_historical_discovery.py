#!/usr/bin/env python3
"""
MT5 HISTORICAL DISCOVERY — READ ONLY

Determines how much usable history this broker actually provides for a
set of symbols/timeframes, WITHOUT downloading a symbol's entire history
just to find out. For each (symbol, timeframe) pair:

  1. PROBE the practical range with two single-row reads:
       - `probe_earliest_bar()` — the earliest bar the broker has.
       - `probe_latest_bar()`   — the most recent bar the broker has.
     Two rows transferred per pair, never the whole history.
  2. Pull a bounded VALIDATION SAMPLE — up to `--max-rows` (default 2000)
     of the MOST RECENT bars (`get_recent_bars()`) — and run the same
     OHLC validation, duplicate detection, gap detection/classification,
     and SHA-256 hashing this repo already uses for every other real
     import (candleValidation.ts / researchDataset.ts conventions,
     mirrored in mt5_data_connector.py).

This script is READ-ONLY and does NOT write to the app's database — no
`ResearchDataset` row is created here. That is a deliberate scope
boundary: DISCOVERY answers "is this symbol/timeframe worth ingesting,
and over what range", a decision for a human to make from this report;
actual persistence happens later via the EXISTING TypeScript path
(`ingestMt5HistoricalData()` / `scripts/mt5-ingest-historical.mjs`) once
a specific range is confirmed practical — never duplicated here as a
second, parallel database-writing path.

TIMEZONE HANDLING (read before trusting a timestamp): every timestamp
this script prints is computed via the SAME `_iso_ms_utc()` convention
already used everywhere else in this module — it takes the raw MT5 epoch
value and labels it "Z" (UTC) WITHOUT adjusting for the broker's actual
server-time offset. MT5 terminals commonly run on a broker-specific
server clock (frequently UTC+2/UTC+3, e.g. EET/EEST) that is NOT
necessarily UTC — this module has no reliable, universal way to query
that offset via the `MetaTrader5` Python package, and does not attempt
to guess it. Treat every timestamp here as "broker server time, labeled
UTC" until/unless the broker's actual server-time offset is confirmed
separately (e.g. from the broker's own documentation).

Like every other real-hardware script in this connector, it checks
ENABLE_DEMO_EXECUTION FIRST and aborts if "true", verifies the account is
genuinely DEMO before reading anything, and never calls order_send or any
order/position-modifying MT5 function.

Usage:
    python3 python/mt5_historical_discovery.py \
        [--symbols BTCUSD,ETHUSD,US500,EURUSD,USDJPY] \
        [--timeframes H1,H4,D1] \
        [--max-rows 2000] \
        [--json-out discovery-report.json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mt5_data_connector as mt5c  # noqa: E402
from mt5_dotenv import load_dotenv_local  # noqa: E402

DEFAULT_SYMBOLS = ["BTCUSD", "ETHUSD", "US500", "EURUSD", "USDJPY"]
DEFAULT_TIMEFRAMES = ["H1", "H4", "D1"]


def _mask_login(login: int) -> str:
    s = str(login)
    if len(s) <= 2:
        return "•" * len(s)
    return "•" * (len(s) - 2) + s[-2:]


def _discover_one(symbol: str, timeframe: str, max_rows: int) -> dict:
    """READ-ONLY discovery for a single (symbol, timeframe) pair. Never
    raises for "symbol not found" or "no history" — those are reported as
    a `status` field instead, so one bad pair never aborts the whole run."""
    found_symbol = mt5c.discover_symbol([symbol])
    if found_symbol is None:
        return {"symbol": symbol, "timeframe": timeframe, "status": "SYMBOL_NOT_FOUND"}

    earliest = mt5c.probe_earliest_bar(found_symbol, timeframe)
    latest = mt5c.probe_latest_bar(found_symbol, timeframe)
    if earliest is None or latest is None:
        return {"symbol": symbol, "timeframe": timeframe, "status": "NO_HISTORY_AVAILABLE"}

    estimated_total = mt5c.estimate_expected_candle_count(earliest["timestamp"], latest["timestamp"], timeframe)

    sample = mt5c.get_recent_bars(found_symbol, timeframe, max_rows)
    if not sample:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "PROBE_OK_BUT_SAMPLE_EMPTY",
            "earliest_available": earliest["timestamp"],
            "latest_available": latest["timestamp"],
            "estimated_total_candles_full_range": estimated_total,
        }

    # duplicate/gap detection run over the RAW sample — same convention
    # already used by mt5_connection_test.py / mt5_symbol_survey.py, a
    # diagnostic of what the broker actually returned. The hash, below,
    # is computed over VALID bars only, mirroring what a real later
    # ingestion (ingestMt5HistoricalData) would persist and hash — the
    # two serve different purposes and are deliberately not the same set.
    validation = mt5c.validate_ohlc_bars(sample)
    valid_bars = validation["valid"]
    invalid_count = len(validation["invalid"])

    duplicate_count = mt5c.count_duplicates(sample)
    gaps = mt5c.list_gap_intervals(sample, timeframe)
    gap_tally: dict[str, int] = {}
    for gap in gaps:
        gap_tally[gap["classification"]] = gap_tally.get(gap["classification"], 0) + 1

    dataset_hash = mt5c.compute_dataset_hash(valid_bars) if valid_bars else None
    sorted_valid = sorted(valid_bars, key=lambda b: b["timestamp"])
    sample_first = sorted_valid[0]["timestamp"] if sorted_valid else None
    sample_last = sorted_valid[-1]["timestamp"] if sorted_valid else None
    coverage_pct = mt5c.compute_sample_coverage_pct(len(valid_bars), sample_first, sample_last, timeframe) if sample_first and sample_last else None

    return {
        "symbol": symbol,
        "mt5_symbol": found_symbol,
        "timeframe": timeframe,
        "status": "OK",
        "earliest_available": earliest["timestamp"],
        "latest_available": latest["timestamp"],
        "estimated_total_candles_full_range": estimated_total,
        "sample_max_rows_requested": max_rows,
        "sample_row_count": len(sample),
        "sample_valid_count": len(valid_bars),
        "sample_invalid_count": invalid_count,
        "sample_first_timestamp": sample_first,
        "sample_last_timestamp": sample_last,
        "sample_duplicate_count": duplicate_count,
        "sample_gap_count": len(gaps),
        "sample_gap_classification": gap_tally,
        "sample_coverage_pct": coverage_pct,
        "dataset_hash": dataset_hash,
        "source": "mt5_demo",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="MT5 HISTORICAL DISCOVERY — read-only, no DB writes.")
    parser.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS), help="Comma-separated EdgeLab/broker symbol names")
    parser.add_argument("--timeframes", default=",".join(DEFAULT_TIMEFRAMES), help="Comma-separated timeframes (H1,H4,D1)")
    parser.add_argument("--max-rows", type=int, default=2000, help="Max bars per validation sample (default 2000 — diagnostic scale, not a bulk import)")
    parser.add_argument("--json-out", default=None, help="Optional path to write the full structured report as JSON")
    args = parser.parse_args()

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    timeframes = [t.strip() for t in args.timeframes.split(",") if t.strip()]
    for tf in timeframes:
        if tf not in ("H1", "H4", "D1"):
            print(f"[MT5] Unsupported timeframe: {tf!r} (supported: H1, H4, D1)")
            return 1

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_local(repo_root / ".env.local")

    print("=== MT5 HISTORICAL DISCOVERY (read-only, no DB writes) ===")

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
            print("[MT5] Aborting — no historical data will be read for a non-demo account.")
            return 1
        print("[MT5] Demo account verified")
        print(f"[MT5] Broker: {account.broker}")
        print(f"[MT5] Symbols: {symbols}")
        print(f"[MT5] Timeframes: {timeframes}")
        print(f"[MT5] Max rows per sample: {args.max_rows}")
        print()

        retrieved_at = mt5c.now_iso_utc()
        results: list[dict] = []
        for symbol in symbols:
            for timeframe in timeframes:
                result = _discover_one(symbol, timeframe, args.max_rows)
                result["broker"] = account.broker
                result["server"] = account.server
                result["retrieved_at"] = retrieved_at
                results.append(result)

                if result["status"] != "OK":
                    print(f"[MT5] {symbol}/{timeframe}: {result['status']}")
                    continue
                coverage = result["sample_coverage_pct"]
                coverage_str = f"{coverage:.1f}%" if coverage is not None else "n/a (no valid bars in sample)"
                print(
                    f"[MT5] {symbol}/{timeframe}: earliest={result['earliest_available']} latest={result['latest_available']} "
                    f"est_total={result['estimated_total_candles_full_range']} | sample={result['sample_row_count']} "
                    f"(valid={result['sample_valid_count']} invalid={result['sample_invalid_count']}) "
                    f"dup={result['sample_duplicate_count']} gaps={result['sample_gap_count']} {result['sample_gap_classification']} "
                    f"coverage={coverage_str} hash={result['dataset_hash']}"
                )

        ok_count = sum(1 for r in results if r["status"] == "OK")
        print()
        print(f"[MT5] Discovery complete: {ok_count}/{len(results)} pairs OK.")

        if args.json_out:
            report = {
                "generated_at": retrieved_at,
                "broker": account.broker,
                "server": account.server,
                "note": "Read-only discovery — no ResearchDataset row was created. Timestamps are broker server time labeled UTC without offset correction (see script docstring).",
                "results": results,
            }
            Path(args.json_out).write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"[MT5] Report written to {args.json_out}")

        print("\n[MT5] Historical discovery PASSED — read-only, no order was ever sent, no DB write performed.")
        return 0
    finally:
        mt5c.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
