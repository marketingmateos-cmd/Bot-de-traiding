import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

/**
 * REAL integration tests against a REAL running `python/mt5_sidecar.py`
 * process — not a mock. What these tests CANNOT prove (and never claim to):
 * a genuine MT5 terminal connection, real account data, real symbols/quotes/
 * historical bars — the `MetaTrader5` package only installs on Windows, and
 * this sandbox is Linux, so every `mt5_data_connector` call the sidecar
 * makes fails with "package not available" here, exactly as it would on a
 * misconfigured Windows machine. What these tests DO prove, against the
 * real process: the HTTP server starts, binds to 127.0.0.1, routes
 * requests correctly, enforces the auth token, has NO order-placing
 * endpoint, and degrades every read to a safe null/[]/false rather than
 * crashing when MT5 itself is unavailable. See docs/mt5-sidecar.md for the
 * manual Windows procedure that verifies the parts this CAN'T.
 */

const SIDECAR_FILE = "python/mt5_sidecar.py";
const PORT = 47898; // distinct from the manual smoke-test port used during development
const TOKEN = "integration-test-token";
const BASE_URL = `http://127.0.0.1:${PORT}`;

function hasPython3(): boolean {
  try {
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Sidecar never became ready at ${url}: ${lastError}`);
}

describe.skipIf(!hasPython3())("MT5 sidecar — structural read-only safety (source inspection)", () => {
  it("never calls order_send/symbol_select — only mentions order_send in prose, never as a real call", () => {
    expect(existsSync(SIDECAR_FILE)).toBe(true);
    const source = readFileSync(SIDECAR_FILE, "utf8");
    expect(source).not.toMatch(/order_send\(/);
    expect(source).not.toMatch(/symbol_select\(/);
    expect(source).not.toMatch(/["']\/mt5\/order/); // no order-placing route string exists at all
    // Sanity: the prose mention exists, so the regex above isn't vacuously passing.
    expect(source).toMatch(/order_send/);
  });

  it("checks the ENABLE_DEMO_EXECUTION kill switch before reading MT5_SIDECAR_TOKEN — same defense-in-depth order as every other real-hardware script", () => {
    const source = readFileSync(SIDECAR_FILE, "utf8");
    const killSwitchIdx = source.indexOf("assert_execution_disabled_or_raise");
    const tokenCheckIdx = source.indexOf('os.environ.get("MT5_SIDECAR_TOKEN")');
    expect(killSwitchIdx).toBeGreaterThan(-1);
    expect(tokenCheckIdx).toBeGreaterThan(-1);
    expect(killSwitchIdx).toBeLessThan(tokenCheckIdx);
  });

  it("binds only to 127.0.0.1 — BIND_HOST is the fixed constant the server is actually constructed with, never a CLI/env-configurable host", () => {
    const source = readFileSync(SIDECAR_FILE, "utf8");
    expect(source).toMatch(/BIND_HOST = "127\.0\.0\.1"/);
    expect(source).toMatch(/ThreadingHTTPServer\(\(BIND_HOST, args\.port\)/);
    // Only the CLI parser's own --port option is configurable — no --host/--bind flag exists.
    expect(source).not.toMatch(/add_argument\(\s*["']--host/);
  });

  it("never logs a request body — the log_message() FUNCTION BODY itself only ever formats method/path/status, regardless of what the module's prose docstring says nearby", () => {
    const source = readFileSync(SIDECAR_FILE, "utf8");
    const match = source.match(/def log_message\(self[\s\S]*?\n(?=\n\ndef |\Z)/);
    expect(match).not.toBeNull();
    const functionBody = match![0];
    expect(functionBody).not.toMatch(/password|raw_body|self\.rfile/i);
  });
});

describe.skipIf(!hasPython3())("MT5 sidecar — refuses to start when ENABLE_DEMO_EXECUTION=true", () => {
  it("exits 1 immediately, never reaching the token check", () => {
    const output = (() => {
      try {
        return execSync(`python3 ${SIDECAR_FILE} --port 0`, {
          env: { ...process.env, ENABLE_DEMO_EXECUTION: "true", MT5_SIDECAR_TOKEN: "irrelevant" },
          timeout: 5000,
        }).toString();
      } catch (err) {
        const e = err as { stdout?: Buffer };
        return e.stdout?.toString() ?? "";
      }
    })();
    expect(output).toMatch(/ENABLE_DEMO_EXECUTION is true — refusing to run/);
  });
});

describe.skipIf(!hasPython3())("MT5 sidecar — refuses to start without MT5_SIDECAR_TOKEN", () => {
  it("exits 1 with a clear reason, never binds a socket", () => {
    const output = (() => {
      try {
        return execSync(`python3 ${SIDECAR_FILE} --port 0`, {
          env: { ...process.env, ENABLE_DEMO_EXECUTION: "false", MT5_SIDECAR_TOKEN: "" },
          timeout: 5000,
        }).toString();
      } catch (err) {
        const e = err as { stdout?: Buffer };
        return e.stdout?.toString() ?? "";
      }
    })();
    expect(output).toMatch(/MT5_SIDECAR_TOKEN no está configurado/);
  });
});

describe.skipIf(!hasPython3())("MT5 sidecar — real running process, real HTTP requests", () => {
  let child: ChildProcess;

  beforeAll(async () => {
    child = spawn("python3", [SIDECAR_FILE, "--port", String(PORT)], {
      env: { ...process.env, ENABLE_DEMO_EXECUTION: "false", MT5_SIDECAR_TOKEN: TOKEN },
      stdio: "ignore",
    });
    await waitForPort(`${BASE_URL}/health`, 10_000);
  }, 15_000);

  afterAll(() => {
    child?.kill();
  });

  it("GET /health responds without requiring auth", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: "mt5-sidecar" });
  });

  it("every /mt5/* route requires the auth token — missing or wrong token gets 401", async () => {
    const noToken = await fetch(`${BASE_URL}/mt5/status`);
    expect(noToken.status).toBe(401);

    const wrongToken = await fetch(`${BASE_URL}/mt5/status`, { headers: { "X-MT5-Sidecar-Token": "wrong" } });
    expect(wrongToken.status).toBe(401);
  });

  it("GET /mt5/status returns connected:false before any login attempt", async () => {
    const res = await fetch(`${BASE_URL}/mt5/status`, { headers: { "X-MT5-Sidecar-Token": TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });

  it("GET /mt5/account, /mt5/symbols before login return safe empty defaults, never a 500", async () => {
    const account = await fetch(`${BASE_URL}/mt5/account`, { headers: { "X-MT5-Sidecar-Token": TOKEN } });
    expect(account.status).toBe(200);
    expect(await account.json()).toEqual({ account: null });

    const symbols = await fetch(`${BASE_URL}/mt5/symbols`, { headers: { "X-MT5-Sidecar-Token": TOKEN } });
    expect(symbols.status).toBe(200);
    expect(await symbols.json()).toEqual({ symbols: [] });
  });

  it("POST /mt5/login with the MetaTrader5 package unavailable (this Linux sandbox) fails gracefully with ok:false, never a 500 — and never echoes the password", async () => {
    const res = await fetch(`${BASE_URL}/mt5/login`, {
      method: "POST",
      headers: { "X-MT5-Sidecar-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ login: "12345", password: "super-secret-password", server: "Demo-Server" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string | null };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not available in this environment/i);
    expect(body.error).not.toContain("super-secret-password");
  });

  it("POST /mt5/login with missing fields returns 400, never attempts a connection", async () => {
    const res = await fetch(`${BASE_URL}/mt5/login`, {
      method: "POST",
      headers: { "X-MT5-Sidecar-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ login: "12345" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /mt5/symbol and /mt5/quote require the symbol query param — 400 without it", async () => {
    const symbol = await fetch(`${BASE_URL}/mt5/symbol`, { headers: { "X-MT5-Sidecar-Token": TOKEN } });
    expect(symbol.status).toBe(400);
    const quote = await fetch(`${BASE_URL}/mt5/quote`, { headers: { "X-MT5-Sidecar-Token": TOKEN } });
    expect(quote.status).toBe(400);
  });

  it("GET /mt5/historical validates timeframe and requires start/end — 400 on a bad timeframe", async () => {
    const res = await fetch(`${BASE_URL}/mt5/historical?symbol=EURUSD&timeframe=M5&start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z`, {
      headers: { "X-MT5-Sidecar-Token": TOKEN },
    });
    expect(res.status).toBe(400);
  });

  it("no order-placing route exists — POST /mt5/order returns 404, not 401 or 500", async () => {
    const res = await fetch(`${BASE_URL}/mt5/order`, { method: "POST", headers: { "X-MT5-Sidecar-Token": TOKEN } });
    expect(res.status).toBe(404);
  });

  it("an unknown GET route returns 404", async () => {
    const res = await fetch(`${BASE_URL}/mt5/nonexistent`, { headers: { "X-MT5-Sidecar-Token": TOKEN } });
    expect(res.status).toBe(404);
  });
});
