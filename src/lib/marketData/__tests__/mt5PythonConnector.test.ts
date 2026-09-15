import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { computeDatasetHash } from "@/lib/research/researchDataset";
import { DEFAULT_MT5_SYMBOL_CANDIDATES } from "@/lib/execution/mt5SymbolMapper";

const PYTHON_DIR = "python";
const CONNECTOR_FILE = `${PYTHON_DIR}/mt5_data_connector.py`;
const TEST_SCRIPT_FILE = `${PYTHON_DIR}/mt5_connection_test.py`;
const PRECHECK_FILE = `${PYTHON_DIR}/mt5_precheck.py`;

function hasPython3(): boolean {
  try {
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runPython(scriptPath: string, envOverrides: Record<string, string | undefined>): { output: string; exitCode: number } {
  const runEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete runEnv[key];
    else runEnv[key] = value;
  }
  try {
    const output = execSync(`python3 ${scriptPath}`, { env: runEnv, cwd: process.cwd() }).toString();
    return { output, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; status?: number };
    return { output: e.stdout?.toString() ?? "", exitCode: e.status ?? 1 };
  }
}

describe("MT5 Data Connector — Python module structural safety (spec section 5)", () => {
  it("mt5_data_connector.py never calls order_send/order_check/order_calc_margin/order_calc_profit — only mentions them in its own doc comment", () => {
    expect(existsSync(CONNECTOR_FILE)).toBe(true);
    const source = readFileSync(CONNECTOR_FILE, "utf8");
    // A real CALL would look like `mt5.order_send(...)` — the doc comment
    // only ever writes the bare name inside backticks/prose, never followed
    // by an opening paren preceded by "mt5.".
    expect(source).not.toMatch(/mt5\.order_send\(/);
    expect(source).not.toMatch(/mt5\.order_check\(/);
    expect(source).not.toMatch(/mt5\.order_calc_margin\(/);
    expect(source).not.toMatch(/mt5\.order_calc_profit\(/);
    // Sanity: the pattern actually exists in prose, so a too-loose regex above isn't just vacuously passing.
    expect(source).toMatch(/order_send/);
  });

  it("mt5_connection_test.py never calls order_send/positions_get/position_close — read-only, per spec section 12", () => {
    expect(existsSync(TEST_SCRIPT_FILE)).toBe(true);
    const source = readFileSync(TEST_SCRIPT_FILE, "utf8");
    expect(source).not.toMatch(/order_send/);
    expect(source).not.toMatch(/positions_get/);
    expect(source).not.toMatch(/position_close/);
  });

  it("mt5_precheck.py never calls login/account_info/copy_rates_range/order_send — only initialize()/version()/shutdown() (MT5 REAL DEMO SMOKE TEST, spec section 1)", () => {
    expect(existsSync(PRECHECK_FILE)).toBe(true);
    const source = readFileSync(PRECHECK_FILE, "utf8");
    expect(source).not.toMatch(/mt5\.login\(/);
    expect(source).not.toMatch(/mt5\.account_info\(/);
    expect(source).not.toMatch(/mt5\.copy_rates_range\(/);
    expect(source).not.toMatch(/order_send/);
  });

  it("neither Python file ever prints MT5_PASSWORD or a raw password variable", () => {
    for (const file of [CONNECTOR_FILE, TEST_SCRIPT_FILE, PRECHECK_FILE]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/print\([^)]*password/i);
    }
  });
});

describe.skipIf(!hasPython3())("MT5 Data Connector — Python <-> TypeScript hash convention consistency (spec section 9)", () => {
  it("compute_dataset_hash() in mt5_data_connector.py produces the BYTE-IDENTICAL hash as computeDatasetHash() for the same bars", () => {
    const bars = [
      { timestamp: new Date("2024-01-01T00:00:00.000Z"), open: 1.1, high: 1.12, low: 1.09, close: 1.11, volume: 100 },
      { timestamp: new Date("2024-01-01T01:00:00.000Z"), open: 1.11, high: 1.13, low: 1.1, close: 1.12, volume: 120.5 },
      { timestamp: new Date("2024-01-01T02:00:00.000Z"), open: 1.12, high: 1.14, low: 1.11, close: 1.135, volume: 0 },
    ];
    const tsHash = computeDatasetHash(bars);

    const pyScript = `
import sys
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
bars = [
  {"timestamp": "2024-01-01T00:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100.0},
  {"timestamp": "2024-01-01T01:00:00.000Z", "open": 1.11, "high": 1.13, "low": 1.1, "close": 1.12, "volume": 120.5},
  {"timestamp": "2024-01-01T02:00:00.000Z", "open": 1.12, "high": 1.14, "low": 1.11, "close": 1.135, "volume": 0.0},
]
print(c.compute_dataset_hash(bars))
`.trim();
    const pyHash = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { cwd: process.cwd() }).toString().trim();

    expect(pyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pyHash).toBe(tsHash);
  });

  it("get_mt5_config() fails with the exact same safe message as the TypeScript side", () => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.MT5_LOGIN;
    delete cleanEnv.MT5_PASSWORD;
    delete cleanEnv.MT5_SERVER;
    const output = execSync(
      `python3 -c 'import sys; sys.path.insert(0, "${PYTHON_DIR}"); import mt5_data_connector as c
try:
    c.get_mt5_config()
    print("UNEXPECTED_NO_ERROR")
except c.Mt5ConfigError as e:
    print(str(e))
'`,
      { env: cleanEnv }
    )
      .toString()
      .trim();
    expect(output).toBe("MT5 configuration is incomplete");
  });

  it("count_duplicates() counts exact-timestamp repeats; count_gaps() counts missing-bar INTERVALS (not individual candles) for H1 — spec section 3", () => {
    const pyScript = `
import sys
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
bars = [
  {"timestamp": "2024-01-01T00:00:00.000Z"},
  {"timestamp": "2024-01-01T00:00:00.000Z"},
  {"timestamp": "2024-01-01T01:00:00.000Z"},
  {"timestamp": "2024-01-01T04:00:00.000Z"},
]
print(c.count_duplicates(bars))
print(c.count_gaps(bars, "H1"))
`.trim();
    const output = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { cwd: process.cwd() })
      .toString()
      .trim()
      .split("\n");
    expect(output[0]).toBe("1");
    expect(output[1]).toBe("1");
  });

  it("count_gaps() reports zero for a contiguous, gap-free H1 series", () => {
    const pyScript = `
import sys
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
bars = [{"timestamp": t} for t in ["2024-01-01T00:00:00.000Z", "2024-01-01T01:00:00.000Z", "2024-01-01T02:00:00.000Z"]]
print(c.count_gaps(bars, "H1"))
print(c.count_duplicates(bars))
`.trim();
    const output = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { cwd: process.cwd() })
      .toString()
      .trim()
      .split("\n");
    expect(output[0]).toBe("0");
    expect(output[1]).toBe("0");
  });

  it("DEFAULT_INDEX_SYMBOL_CANDIDATES in mt5_data_connector.py matches DEFAULT_MT5_SYMBOL_CANDIDATES in mt5SymbolMapper.ts EXACTLY for US500/NAS100/DAX", () => {
    const pyScript = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
print(json.dumps(c.DEFAULT_INDEX_SYMBOL_CANDIDATES))
`.trim();
    const pyOutput = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { cwd: process.cwd() }).toString().trim();
    const pyCandidates = JSON.parse(pyOutput);
    expect(pyCandidates).toEqual({
      US500: [...DEFAULT_MT5_SYMBOL_CANDIDATES.US500],
      NAS100: [...DEFAULT_MT5_SYMBOL_CANDIDATES.NAS100],
      DAX: [...DEFAULT_MT5_SYMBOL_CANDIDATES.DAX],
    });
  });
});

describe.skipIf(!hasPython3())("MT5 REAL DEMO SMOKE TEST — execution kill switch aborts mt5_connection_test.py before anything else (spec section 5)", () => {
  it("aborts immediately, exit code 1, when ENABLE_DEMO_EXECUTION=true — never even reaches the credential check", () => {
    const { output, exitCode } = runPython(TEST_SCRIPT_FILE, {
      ENABLE_DEMO_EXECUTION: "true",
      MT5_LOGIN: undefined,
      MT5_PASSWORD: undefined,
      MT5_SERVER: undefined,
    });
    expect(exitCode).toBe(1);
    expect(output).toMatch(/ENABLE_DEMO_EXECUTION is true — refusing to run/);
    expect(output).not.toMatch(/MT5 configuration is incomplete/);
  });

  it("treats any non-'true' value (case-insensitive comparison, exact match required) as disabled and proceeds past the kill-switch check", () => {
    const { output, exitCode } = runPython(TEST_SCRIPT_FILE, {
      ENABLE_DEMO_EXECUTION: "TRUE_BUT_NOT_EXACTLY",
      MT5_LOGIN: undefined,
      MT5_PASSWORD: undefined,
      MT5_SERVER: undefined,
    });
    expect(exitCode).toBe(1);
    expect(output).not.toMatch(/ENABLE_DEMO_EXECUTION is true/);
    expect(output).toMatch(/MT5 configuration is incomplete/);
  });

  it("proceeds past the kill-switch check when ENABLE_DEMO_EXECUTION is unset, then fails safely (and expectedly) on missing credentials", () => {
    const { output, exitCode } = runPython(TEST_SCRIPT_FILE, {
      ENABLE_DEMO_EXECUTION: undefined,
      MT5_LOGIN: undefined,
      MT5_PASSWORD: undefined,
      MT5_SERVER: undefined,
    });
    expect(exitCode).toBe(1);
    expect(output).toMatch(/MT5 configuration is incomplete/);
  });
});

describe.skipIf(!hasPython3())("MT5 REAL DEMO SMOKE TEST — mt5_precheck.py (spec section 1)", () => {
  it("on this Linux sandbox, reports Windows and the MetaTrader5 package as MISSING, and never prints a credential value", () => {
    const { output, exitCode } = runPython(PRECHECK_FILE, {
      MT5_LOGIN: "12345",
      MT5_PASSWORD: "hunter2-should-never-appear",
      MT5_SERVER: "Demo-Server",
    });
    expect(exitCode).toBe(1);
    expect(output).toMatch(/\[MISSING\] Windows/);
    expect(output).toMatch(/\[MISSING\] MetaTrader5 package/);
    expect(output).toMatch(/\[OK\] Environment variables/);
    expect(output).not.toContain("hunter2-should-never-appear");
  });

  it("names WHICH env var(s) are missing by NAME — a deliberately different convention from get_mt5_config()'s intentionally-vague message, since this is a local diagnostic tool, never a value leak", () => {
    const { output } = runPython(PRECHECK_FILE, {
      MT5_LOGIN: undefined,
      MT5_PASSWORD: undefined,
      MT5_SERVER: "Demo-Server",
    });
    expect(output).toMatch(/Missing environment variable\(s\): MT5_LOGIN, MT5_PASSWORD/);
  });

  it("exits 0 only when every check passes — impossible to fake here since Windows/MetaTrader5 can never be satisfied on this sandbox", () => {
    const { exitCode } = runPython(PRECHECK_FILE, {
      MT5_LOGIN: "12345",
      MT5_PASSWORD: "x",
      MT5_SERVER: "Demo-Server",
    });
    expect(exitCode).toBe(1);
  });
});
