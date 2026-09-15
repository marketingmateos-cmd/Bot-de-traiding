#!/usr/bin/env python3
"""
MT5 SYMBOL RESOLUTION — READ ONLY

Resolves canonical instrument names (EURUSD, USDJPY, XAUUSD/GOLD) to THIS
broker's actual native symbol names, using the broker's OWN live symbol
list and category metadata (`list_all_symbols()` / `path`) — never a
hardcoded per-broker suffix guess (see
`mt5_data_connector.resolve_canonical_symbol()`). This exists because the
exact-match discovery used elsewhere (`discover_symbol()`) can correctly
report SYMBOL_NOT_FOUND for a canonical name even when the instrument IS
available, just under a broker-decorated variant (EURUSD.pro, EURUSDm,
EURUSD_i, ...).

For every symbol this resolves, it then runs the SAME small, read-only
H1/H4/D1 validation as `mt5_historical_discovery.py`
(`discover_symbol_timeframe()`, reused — not duplicated): earliest/latest
practical timestamps, a bounded recent sample, OHLC validity, duplicate
count, gap count/classification, and a deterministic SHA-256 hash. No
`ResearchDataset` is created and nothing is written to the app's
database — same read-only scope boundary as the historical-discovery
phase.

Like every other real-hardware script in this connector, it checks
ENABLE_DEMO_EXECUTION FIRST and aborts if "true", verifies the account is
genuinely DEMO before reading anything, and never calls order_send or any
order/position-modifying MT5 function.

Usage:
    python3 python/mt5_symbol_resolution.py \
        [--roots EURUSD,USDJPY,XAUUSD] \
        [--timeframes H1,H4,D1] \
        [--max-rows 500] \
        [--json-out resolution-report.json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mt5_data_connector as mt5c  # noqa: E402
from mt5_dotenv import load_dotenv_local  # noqa: E402
from mt5_historical_discovery import discover_symbol_timeframe  # noqa: E402

DEFAULT_ROOTS = ["EURUSD", "USDJPY", "XAUUSD"]
DEFAULT_TIMEFRAMES = ["H1", "H4", "D1"]
# XAUUSD is tried under both common canonical spellings — the SAME
# candidate convention already used elsewhere in this connector
# (DEFAULT_MT5_SYMBOL_CANDIDATES in mt5SymbolMapper.ts / this module's own
# DEFAULT_INDEX_SYMBOL_CANDIDATES) — never invents a third spelling.
_ALTERNATE_ROOTS = {"XAUUSD": ["XAUUSD", "GOLD"]}


def _mask_login(login: int) -> str:
    s = str(login)
    if len(s) <= 2:
        return "•" * len(s)
    return "•" * (len(s) - 2) + s[-2:]


def _resolve_root(root: str, all_symbols: list[dict]) -> dict:
    """Tries every alternate spelling for `root` (e.g. XAUUSD then GOLD),
    returning the FIRST that resolves to a real broker symbol. Reports
    every alternate tried, never silently picks one without saying so."""
    alternates = _ALTERNATE_ROOTS.get(root, [root])
    for alt in alternates:
        result = mt5c.resolve_canonical_symbol(alt, all_symbols)
        if result["resolved"] is not None:
            result["root"] = root  # report under the originally-requested canonical name
            result["matched_alternate"] = alt
            result["alternates_tried"] = alternates
            return result
    return {"root": root, "resolved": None, "mt5_symbol": None, "tier": None, "path": None, "candidates": [], "matched_alternate": None, "alternates_tried": alternates}


def main() -> int:
    parser = argparse.ArgumentParser(description="MT5 symbol resolution + small read-only validation — no DB writes.")
    parser.add_argument("--roots", default=",".join(DEFAULT_ROOTS), help="Comma-separated canonical instrument names to resolve")
    parser.add_argument("--timeframes", default=",".join(DEFAULT_TIMEFRAMES), help="Comma-separated timeframes (H1,H4,D1)")
    parser.add_argument("--max-rows", type=int, default=500, help="Max bars per validation sample (default 500 — small, per spec, not a bulk import)")
    parser.add_argument("--json-out", default=None, help="Optional path to write the full structured report as JSON")
    args = parser.parse_args()

    roots = [r.strip() for r in args.roots.split(",") if r.strip()]
    timeframes = [t.strip() for t in args.timeframes.split(",") if t.strip()]
    for tf in timeframes:
        if tf not in ("H1", "H4", "D1"):
            print(f"[MT5] Unsupported timeframe: {tf!r} (supported: H1, H4, D1)")
            return 1

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_local(repo_root / ".env.local")

    print("=== MT5 SYMBOL RESOLUTION (read-only, no DB writes) ===")

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

        print("\n--- Symbol resolution (broker's own name/path metadata) ---")
        all_symbols = mt5c.list_all_symbols()
        resolutions: dict[str, dict] = {}
        for root in roots:
            resolution = _resolve_root(root, all_symbols)
            resolutions[root] = resolution
            if resolution["resolved"]:
                extra = f" (via alternate {resolution['matched_alternate']!r})" if resolution["matched_alternate"] != root else ""
                print(f"[MT5] {root} -> {resolution['resolved']}{extra} [{resolution['tier']}] path={resolution['path']}")
                if len(resolution["candidates"]) > 1:
                    other_names = [c["name"] for c in resolution["candidates"] if c["name"] != resolution["resolved"]]
                    print(f"[MT5]   (ambiguous — also matched: {other_names})")
            else:
                print(f"[MT5] {root} -> NOT FOUND (tried: {resolution['alternates_tried']})")

        print("\n--- Small read-only validation for resolved symbols ---")
        retrieved_at = mt5c.now_iso_utc()
        results: list[dict] = []
        for root in roots:
            resolution = resolutions[root]
            if not resolution["resolved"]:
                continue
            for timeframe in timeframes:
                result = discover_symbol_timeframe(resolution["mt5_symbol"], timeframe, args.max_rows, display_symbol=root)
                result["broker"] = account.broker
                result["server"] = account.server
                result["retrieved_at"] = retrieved_at
                result["resolution_tier"] = resolution["tier"]
                result["resolution_path"] = resolution["path"]
                results.append(result)

                if result["status"] != "OK":
                    print(f"[MT5] {root}/{timeframe}: {result['status']}")
                    continue
                coverage = result["sample_coverage_pct"]
                coverage_str = f"{coverage:.1f}%" if coverage is not None else "n/a (no valid bars in sample)"
                print(
                    f"[MT5] {root}/{timeframe} ({resolution['mt5_symbol']}): earliest={result['earliest_available']} latest={result['latest_available']} "
                    f"| sample={result['sample_row_count']} (valid={result['sample_valid_count']} invalid={result['sample_invalid_count']}) "
                    f"dup={result['sample_duplicate_count']} gaps={result['sample_gap_count']} {result['sample_gap_classification']} "
                    f"coverage={coverage_str} hash={result['dataset_hash']}"
                )

        ok_count = sum(1 for r in results if r["status"] == "OK")
        print()
        print(f"[MT5] Resolution + validation complete: {ok_count}/{len(results)} symbol/timeframe pairs OK.")

        if args.json_out:
            report = {
                "generated_at": retrieved_at,
                "broker": account.broker,
                "server": account.server,
                "note": "Read-only symbol resolution + validation — no ResearchDataset row was created. Timestamps are broker server time labeled UTC without offset correction.",
                "resolutions": resolutions,
                "results": results,
            }
            Path(args.json_out).write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"[MT5] Report written to {args.json_out}")

        print("\n[MT5] Symbol resolution PASSED — read-only, no order was ever sent, no DB write performed.")
        return 0
    finally:
        mt5c.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
