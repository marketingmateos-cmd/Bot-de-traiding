#!/usr/bin/env python3
"""
MT5 SIDECAR — the local HTTP bridge between this repo's Node/TypeScript app
and a real MetaTrader 5 terminal (Windows/Wine only — see
mt5_data_connector.py's own module docstring for why).

WHAT THIS IS: a small, stdlib-only (`http.server`, no new dependency) JSON
HTTP server that runs ALONGSIDE the Node app (as a separate OS process,
started manually or by a future Electron wiring step) and exposes exactly
the READ-ONLY subset of `mt5_data_connector.py` the TypeScript side's
`Mt5ClientLike` interface (src/lib/execution/mt5Client.ts) needs:
login/logout, connection status, account info, symbol list, symbol spec,
quote, and historical bars. `src/lib/execution/mt5SidecarClient.ts` is the
TypeScript HTTP client that talks to it.

WHAT THIS DELIBERATELY IS NOT: there is NO order-placing endpoint anywhere
in this file — not disabled, not gated, ABSENT. `Mt5ClientLike.orderSend()`
is implemented entirely on the TypeScript side to always reject WITHOUT
ever issuing an HTTP request to this server (see mt5SidecarClient.ts) — so
even if a future bug removed that TypeScript-side guard, there would still
be nothing here to call. Grep this file for "order_send" or "orderSend":
the only matches are in this docstring's own prose, never a call.

SECURITY:
  - Binds to 127.0.0.1 ONLY — never 0.0.0.0. This process accepts MT5
    credentials over HTTP; it must never be reachable from the LAN, unlike
    the Electron app's own Next.js server which deliberately does bind
    0.0.0.0 for phone access to the READ side of the app.
  - Every /mt5/* request must carry a shared-secret bearer token in the
    `X-MT5-Sidecar-Token` header, compared with `hmac.compare_digest`
    (constant-time). The token comes from the `MT5_SIDECAR_TOKEN`
    environment variable, set by whoever starts BOTH this process and the
    Node app — this process refuses to start at all if it's unset (fail
    closed, same "abort immediately and visibly" convention as
    ENABLE_DEMO_EXECUTION elsewhere in this connector).
  - Like every other real-hardware script in this connector, checks
    ENABLE_DEMO_EXECUTION FIRST and refuses to start if it's "true" — this
    sidecar is READ-ONLY by design and has no code path that could place
    an order even if it wanted to, but this is defense in depth, matching
    every other entry point in python/*.py.
  - Never logs a request body (credentials arrive only in the POST /mt5/login
    body) — this handler's logging override only ever prints method+path+
    status, exactly like the stdlib default, never any body content.

Usage (on Windows, with a real MT5 DEMO terminal installed and running):
    set MT5_SIDECAR_TOKEN=<a random string you choose>
    python python\\mt5_sidecar.py [--port 47822]

See docs/mt5-sidecar.md for the full manual Windows test procedure — this
module has never been run against a real MT5 terminal from this repository
(this sandbox is Linux); only its HTTP plumbing is exercised by the tests
in src/lib/execution/__tests__/mt5Sidecar.test.ts, against a real running
instance of THIS process with the `MetaTrader5` package unavailable (so
every `mt5_data_connector` call fails exactly the way it would on a
misconfigured Windows machine — this proves the HTTP layer, auth, and
error handling, never a real MT5 connection).
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mt5_data_connector as mt5c  # noqa: E402

DEFAULT_PORT = 47822
BIND_HOST = "127.0.0.1"  # never configurable — see module docstring

# Tracks whether `mt5_data_connector.initialize_and_login()` has succeeded
# and neither `logout` nor `shutdown` has been called since. Read endpoints
# consult this FIRST rather than letting a raw mt5_data_connector exception
# surface, so "not logged in yet" is always a clean {"...": null}/[] JSON
# response, never a 500 — matching `Mt5ClientLike`'s own "never throws for
# an ordinary not-connected state" contract.
_logged_in = False


def _parse_iso(value: str) -> datetime:
    """Accepts the exact `...Z` ISO format this whole connector already
    produces/consumes elsewhere (`_iso_ms_utc`) — `datetime.fromisoformat`
    only accepts `+00:00`, not a bare `Z`, on Python versions before 3.11,
    so this repo's own convention is normalized here rather than assuming
    a specific Python minor version."""
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class _JsonError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _require_symbol(query: dict[str, list[str]]) -> str:
    values = query.get("symbol")
    if not values or not values[0]:
        raise _JsonError(400, "Falta el parámetro obligatorio 'symbol'.")
    return values[0]


# ── Route handlers — each returns (status_code, json_body) ─────────────────


def handle_login(body: dict[str, Any]) -> tuple[int, dict]:
    global _logged_in
    login_raw = body.get("login")
    password = body.get("password")
    server = body.get("server")
    if not login_raw or not password or not server:
        return 400, {"ok": False, "error": "login, password y server son obligatorios."}
    try:
        login = int(login_raw)
    except (TypeError, ValueError):
        return 400, {"ok": False, "error": "login debe ser un número de cuenta MT5 válido."}

    config = mt5c.Mt5Config(login=login, password=str(password), server=str(server))
    try:
        mt5c.initialize_and_login(config)
    except mt5c.Mt5ConnectionError as exc:
        _logged_in = False
        # mt5_data_connector's own exception messages come from MT5's
        # last_error() or _require_mt5_package()'s fixed string — neither
        # ever includes the password (verified by this connector's own
        # existing "never prints password" structural tests).
        return 200, {"ok": False, "error": str(exc)}

    _logged_in = True
    return 200, {"ok": True, "error": None}


def handle_logout(_body: dict[str, Any]) -> tuple[int, dict]:
    global _logged_in
    mt5c.shutdown()
    _logged_in = False
    return 200, {}


def handle_status(_query: dict[str, list[str]]) -> tuple[int, dict]:
    return 200, {"connected": _logged_in and mt5c.is_initialized()}


def handle_account(_query: dict[str, list[str]]) -> tuple[int, dict]:
    if not _logged_in:
        return 200, {"account": None}
    try:
        summary = mt5c.get_account_info()
    except mt5c.Mt5ConnectionError:
        return 200, {"account": None}
    return 200, {
        "account": {
            "broker": summary.broker,
            "server": summary.server,
            "loginId": str(summary.login),
            "accountType": mt5c.account_type_label(summary.trade_mode),
            "balance": summary.balance,
            "equity": summary.equity,
            "margin": summary.margin,
            "freeMargin": summary.free_margin,
            "leverage": summary.leverage,
            "currency": summary.currency,
        }
    }


def handle_symbols(_query: dict[str, list[str]]) -> tuple[int, dict]:
    if not _logged_in:
        return 200, {"symbols": []}
    try:
        symbols = mt5c.list_all_symbols()
    except mt5c.Mt5ConnectionError:
        return 200, {"symbols": []}
    return 200, {"symbols": [s["name"] for s in symbols]}


def handle_symbol_spec(query: dict[str, list[str]]) -> tuple[int, dict]:
    symbol = _require_symbol(query)
    if not _logged_in:
        return 200, {"spec": None}
    try:
        spec = mt5c.get_symbol_spec(symbol)
    except mt5c.Mt5ConnectionError:
        return 200, {"spec": None}
    return 200, {"spec": spec}


def handle_quote(query: dict[str, list[str]]) -> tuple[int, dict]:
    symbol = _require_symbol(query)
    if not _logged_in:
        return 200, {"quote": None}
    try:
        quote = mt5c.get_quote(symbol)
    except mt5c.Mt5ConnectionError:
        return 200, {"quote": None}
    return 200, {"quote": quote}


_SUPPORTED_HISTORICAL_TIMEFRAMES = ("H1", "H4", "D1")


def handle_historical(query: dict[str, list[str]]) -> tuple[int, dict]:
    symbol = _require_symbol(query)
    timeframe = (query.get("timeframe") or [""])[0]
    if timeframe not in _SUPPORTED_HISTORICAL_TIMEFRAMES:
        raise _JsonError(400, f"timeframe debe ser uno de {_SUPPORTED_HISTORICAL_TIMEFRAMES} (recibido: {timeframe!r}).")
    start_raw = (query.get("start") or [""])[0]
    end_raw = (query.get("end") or [""])[0]
    if not start_raw or not end_raw:
        raise _JsonError(400, "Los parámetros 'start' y 'end' (ISO 8601) son obligatorios.")
    try:
        start = _parse_iso(start_raw)
        end = _parse_iso(end_raw)
    except ValueError:
        raise _JsonError(400, "start/end deben ser fechas ISO 8601 válidas.") from None

    if not _logged_in:
        return 200, {"bars": []}
    try:
        bars = mt5c.get_historical_rates(symbol, timeframe, start, end)
    except mt5c.Mt5ConnectionError:
        return 200, {"bars": []}
    return 200, {
        "bars": [
            {
                "timestamp": b["timestamp"],
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b["volume"],
                "tickVolume": b["tick_volume"],
                "spread": b["spread"],
                "realVolume": b["real_volume"],
            }
            for b in bars
        ]
    }


def handle_health(_query: dict[str, list[str]]) -> tuple[int, dict]:
    return 200, {"ok": True, "service": "mt5-sidecar"}


# ── HTTP plumbing ────────────────────────────────────────────────────────

_GET_ROUTES: dict[str, Callable[[dict[str, list[str]]], tuple[int, dict]]] = {
    "/health": handle_health,
    "/mt5/status": handle_status,
    "/mt5/account": handle_account,
    "/mt5/symbols": handle_symbols,
    "/mt5/symbol": handle_symbol_spec,
    "/mt5/quote": handle_quote,
    "/mt5/historical": handle_historical,
}

_POST_ROUTES: dict[str, Callable[[dict[str, Any]], tuple[int, dict]]] = {
    "/mt5/login": handle_login,
    "/mt5/logout": handle_logout,
}


class Mt5SidecarHandler(BaseHTTPRequestHandler):
    server_version = "Mt5Sidecar/1.0"

    def _check_auth(self) -> bool:
        expected = os.environ.get("MT5_SIDECAR_TOKEN", "")
        provided = self.headers.get("X-MT5-Sidecar-Token", "")
        return hmac.compare_digest(expected, provided)

    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming convention)
        split = urlsplit(self.path)
        if split.path == "/health":
            self._write_json(*handle_health({}))
            return
        if not self._check_auth():
            self._write_json(401, {"error": "Token de autenticación ausente o inválido."})
            return
        handler = _GET_ROUTES.get(split.path)
        if handler is None:
            self._write_json(404, {"error": f"Ruta no encontrada: {split.path}"})
            return
        query = parse_qs(split.query)
        try:
            self._write_json(*handler(query))
        except _JsonError as exc:
            self._write_json(exc.status, {"error": exc.message})
        except Exception as exc:  # noqa: BLE001 — last-resort, never leaks a credential (no request body reaches this path)
            self._write_json(500, {"error": f"Error interno del sidecar: {exc}"})

    def do_POST(self) -> None:  # noqa: N802
        split = urlsplit(self.path)
        if not self._check_auth():
            self._write_json(401, {"error": "Token de autenticación ausente o inválido."})
            return
        handler = _POST_ROUTES.get(split.path)
        if handler is None:
            self._write_json(404, {"error": f"Ruta no encontrada: {split.path}"})
            return
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            self._write_json(400, {"error": "Cuerpo de la petición no es JSON válido."})
            return
        try:
            self._write_json(*handler(body))
        except _JsonError as exc:
            self._write_json(exc.status, {"error": exc.message})
        except Exception as exc:  # noqa: BLE001
            self._write_json(500, {"error": f"Error interno del sidecar: {exc}"})

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 (stdlib signature)
        # Never logs a request BODY — only method/path/status, same as the
        # stdlib default, just prefixed for clarity in a mixed log stream.
        sys.stderr.write(f"[MT5-Sidecar] {self.address_string()} - {format % args}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="MT5 Sidecar — local read-only HTTP bridge to a real MT5 terminal (Windows only).")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind on 127.0.0.1 (default {DEFAULT_PORT})")
    args = parser.parse_args()

    print("=== MT5 SIDECAR (read-only HTTP bridge) ===")

    try:
        mt5c.assert_execution_disabled_or_raise()
    except mt5c.Mt5ExecutionEnabledError as exc:
        print(f"[MT5-Sidecar] {exc}")
        return 1

    if not os.environ.get("MT5_SIDECAR_TOKEN"):
        print("[MT5-Sidecar] MT5_SIDECAR_TOKEN no está configurado — abortando. Este proceso acepta credenciales MT5 por HTTP y se niega a arrancar sin un token compartido (ver docs/mt5-sidecar.md).")
        return 1

    server = ThreadingHTTPServer((BIND_HOST, args.port), Mt5SidecarHandler)
    print(f"[MT5-Sidecar] Escuchando en http://{BIND_HOST}:{args.port} (solo localhost, nunca LAN)")
    print("[MT5-Sidecar] READ-ONLY: no existe ningún endpoint de envío de órdenes en este proceso.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        mt5c.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
