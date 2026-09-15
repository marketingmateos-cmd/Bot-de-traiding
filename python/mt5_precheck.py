#!/usr/bin/env python3
"""
MT5 REAL DEMO — ENVIRONMENT PRECHECK

Checks, without ever connecting to a broker, logging in, or printing a
secret, whether THIS machine can run a real MT5 DEMO data-connector smoke
test (python/mt5_connection_test.py):

  1. Operating system is Windows — the official `MetaTrader5` Python
     package only installs/works on Windows, talking to a local MT5
     terminal process (see docs/mt5-data-connector.md §2).
  2. A usable Python 3 interpreter (>= 3.8).
  3. The `MetaTrader5` package is importable.
  4. A real MT5 terminal is reachable — `mt5.initialize()` succeeds. This
     does NOT log in, place an order, or touch any account; it only
     confirms the terminal process is installed and reachable, then
     immediately shuts the connection back down.
  5. `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` are present in the
     environment (read from `.env.local` if present; a real exported
     env var always wins over the file).

Unlike `get_mt5_config()` in `mt5_data_connector.py` (whose error message
deliberately never names which credential is missing, because that
function sits on the real authentication path and a named-variable error
there would be a side channel), THIS script's whole purpose is local
diagnostics for the person setting up their own machine — so, per spec,
it names exactly which check(s) failed and, for #5, exactly which
variable NAME(s) are absent. It never prints a variable's VALUE.

Exit code 0 only if every check passes. Never calls `login`,
`account_info`, `copy_rates_range`, or anything order-shaped.

Usage:
    python3 python/mt5_precheck.py
"""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mt5_dotenv import load_dotenv_local  # noqa: E402

CheckResult = tuple[bool, str]


def _check_windows() -> CheckResult:
    system = platform.system()
    if system == "Windows":
        return True, f"Windows detected ({platform.release()})"
    return False, f"Not running on Windows (detected: {system!r}) — the MetaTrader5 package only works on Windows, talking to a local MT5 terminal process."


def _check_python() -> CheckResult:
    v = sys.version_info
    if (v.major, v.minor) >= (3, 8):
        return True, f"Python {v.major}.{v.minor}.{v.micro}"
    return False, f"Python {v.major}.{v.minor}.{v.micro} detected — 3.8 or newer is required."


def _check_package() -> CheckResult:
    try:
        import MetaTrader5  # noqa: F401

        return True, "MetaTrader5 package importable"
    except ImportError as exc:
        return False, f"MetaTrader5 package is not installed ({type(exc).__name__}) — run: pip install MetaTrader5"


def _check_terminal() -> CheckResult:
    try:
        import MetaTrader5 as mt5
    except ImportError:
        return False, "Cannot check — the MetaTrader5 package is not installed (see the check above)."

    if mt5.initialize():
        try:
            version = mt5.version()
        finally:
            mt5.shutdown()
        return True, f"MT5 terminal reachable (version={version})"

    code, description = mt5.last_error()
    return False, f"MT5 terminal not reachable: [{code}] {description} — make sure MetaTrader 5 is installed and has been opened at least once on this machine."


def _check_env_vars() -> CheckResult:
    missing = [name for name in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER") if not os.environ.get(name)]
    if not missing:
        return True, "MT5_LOGIN / MT5_PASSWORD / MT5_SERVER are all present"
    return False, f"Missing environment variable(s): {', '.join(missing)} — set them in .env.local (values are never shown or logged)."


_CHECKS: list[tuple[str, Callable[[], CheckResult]]] = [
    ("Windows", _check_windows),
    ("Python", _check_python),
    ("MetaTrader5 package", _check_package),
    ("MT5 terminal", _check_terminal),
    ("Environment variables", _check_env_vars),
]


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_local(repo_root / ".env.local")

    print("=== MT5 REAL DEMO — ENVIRONMENT PRECHECK (read-only, no login) ===")

    all_ok = True
    for name, check in _CHECKS:
        ok, detail = check()
        print(f"[{'OK' if ok else 'MISSING'}] {name}: {detail}")
        all_ok = all_ok and ok

    print()
    if all_ok:
        print("[MT5] Precheck PASSED — ready to run: python3 python/mt5_connection_test.py")
        return 0
    print("[MT5] Precheck FAILED — fix the item(s) marked MISSING above, then re-run this script.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
