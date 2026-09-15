"""
Minimal, dependency-free `.env.local` loader shared by the MT5 Data
Connector's standalone scripts (`mt5_precheck.py`, `mt5_connection_test.py`).

Only ever sets `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` /
`ENABLE_DEMO_EXECUTION` — and only if the variable ISN'T already present
in the real environment (an explicitly exported var always wins over the
file). Never logs, prints, or echoes a value it reads.
"""

from __future__ import annotations

import os
from pathlib import Path

_MANAGED_KEYS = ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER", "ENABLE_DEMO_EXECUTION")


def load_dotenv_local(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        if key not in _MANAGED_KEYS:
            continue
        if key in os.environ:
            continue
        value = value.strip().strip('"').strip("'")
        os.environ[key] = value
