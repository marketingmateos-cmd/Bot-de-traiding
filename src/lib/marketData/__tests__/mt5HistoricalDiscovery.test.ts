import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const PYTHON_DIR = "python";
const CONNECTOR_FILE = `${PYTHON_DIR}/mt5_data_connector.py`;
const DISCOVERY_FILE = `${PYTHON_DIR}/mt5_historical_discovery.py`;

function hasPython3(): boolean {
  try {
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runPython(scriptPath: string, envOverrides: Record<string, string | undefined>, extraArgs: string[] = []): { output: string; exitCode: number } {
  const runEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete runEnv[key];
    else runEnv[key] = value;
  }
  try {
    const output = execSync(`python3 ${scriptPath} ${extraArgs.join(" ")}`, { env: runEnv, cwd: process.cwd() }).toString();
    return { output, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; status?: number };
    return { output: e.stdout?.toString() ?? "", exitCode: e.status ?? 1 };
  }
}

function runPySnippet(script: string): string {
  return execSync(`python3 -c '${script.trim().replace(/'/g, "'\\''")}'`, { cwd: process.cwd() }).toString().trim();
}

describe("MT5 HISTORICAL DISCOVERY — structural read-only safety guard", () => {
  it("mt5_historical_discovery.py never calls order_send/positions_get/position_close/symbol_select — only mentions them in prose, never as a real call", () => {
    expect(existsSync(DISCOVERY_FILE)).toBe(true);
    const source = readFileSync(DISCOVERY_FILE, "utf8");
    expect(source).not.toMatch(/order_send\(/);
    expect(source).not.toMatch(/positions_get\(/);
    expect(source).not.toMatch(/position_close\(/);
    expect(source).not.toMatch(/symbol_select\(/);
    // Sanity: the prose mention exists, so the regex above isn't vacuously passing.
    expect(source).toMatch(/order_send/);
  });

  it("mt5_historical_discovery.py never writes to the database — no Prisma/SQL import, no ResearchDataset creation, purely a read-only report", () => {
    const source = readFileSync(DISCOVERY_FILE, "utf8");
    expect(source).not.toMatch(/prisma/i);
    expect(source).not.toMatch(/INSERT INTO/i);
    expect(source).not.toMatch(/registerResearchDataset/);
  });

  it("never prints MT5_PASSWORD or a raw password variable", () => {
    const source = readFileSync(DISCOVERY_FILE, "utf8");
    expect(source).not.toMatch(/print\([^)]*password/i);
  });

  it("checks the ENABLE_DEMO_EXECUTION kill switch before reading any credential — same defense-in-depth pattern as the other real-hardware scripts", () => {
    const source = readFileSync(DISCOVERY_FILE, "utf8");
    const killSwitchIdx = source.indexOf("assert_execution_disabled_or_raise");
    const configIdx = source.indexOf("get_mt5_config()");
    expect(killSwitchIdx).toBeGreaterThan(-1);
    expect(configIdx).toBeGreaterThan(-1);
    expect(killSwitchIdx).toBeLessThan(configIdx);
  });
});

describe.skipIf(!hasPython3())("MT5 HISTORICAL DISCOVERY — execution kill switch aborts before anything else", () => {
  it("aborts immediately, exit code 1, when ENABLE_DEMO_EXECUTION=true — never reaches the credential check", () => {
    const { output, exitCode } = runPython(DISCOVERY_FILE, {
      ENABLE_DEMO_EXECUTION: "true",
      MT5_LOGIN: undefined,
      MT5_PASSWORD: undefined,
      MT5_SERVER: undefined,
    });
    expect(exitCode).toBe(1);
    expect(output).toMatch(/ENABLE_DEMO_EXECUTION is true — refusing to run/);
    expect(output).not.toMatch(/MT5 configuration is incomplete/);
  });

  it("rejects an unsupported timeframe before ever touching credentials or connecting", () => {
    const { output, exitCode } = runPython(DISCOVERY_FILE, { MT5_LOGIN: "1", MT5_PASSWORD: "x", MT5_SERVER: "Demo" }, ["--timeframes", "M5"]);
    expect(exitCode).toBe(1);
    expect(output).toMatch(/Unsupported timeframe: 'M5'/);
    expect(output).not.toMatch(/Login:/); // never even gets to printing the masked login
  });
});

describe.skipIf(!hasPython3())("MT5 HISTORICAL DISCOVERY — validate_ohlc_bars() (normalization / OHLC validation)", () => {
  it("accepts a well-formed bar and rejects high < low, zero price, negative volume, and non-finite values, each with its own reason", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
bars = [
  {"timestamp": "2024-01-01T00:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100},
  {"timestamp": "2024-01-01T01:00:00.000Z", "open": 1.1, "high": 1.05, "low": 1.09, "close": 1.11, "volume": 100},
  {"timestamp": "2024-01-01T02:00:00.000Z", "open": 0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 10},
  {"timestamp": "2024-01-01T03:00:00.000Z", "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": -5},
  {"timestamp": "2024-01-01T04:00:00.000Z", "open": float("nan"), "high": 1.1, "low": 0.9, "close": 1.0, "volume": 10},
]
result = c.validate_ohlc_bars(bars)
print(json.dumps({"valid_count": len(result["valid"]), "invalid_count": len(result["invalid"])}))
`.trim();
    const output = runPySnippet(py);
    expect(JSON.parse(output)).toEqual({ valid_count: 1, invalid_count: 4 });
  });

  it("valid bars preserve the broker-native fields unchanged — no silent normalization of the values themselves", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
bar = {"timestamp": "2024-01-01T00:00:00.000Z", "open": 1.10001, "high": 1.12345, "low": 1.09999, "close": 1.11111, "volume": 250}
result = c.validate_ohlc_bars([bar])
print(json.dumps(result["valid"][0]))
`.trim();
    const output = runPySnippet(py);
    expect(JSON.parse(output)).toEqual({ timestamp: "2024-01-01T00:00:00.000Z", open: 1.10001, high: 1.12345, low: 1.09999, close: 1.11111, volume: 250 });
  });
});

describe.skipIf(!hasPython3())("MT5 HISTORICAL DISCOVERY — estimate_expected_candle_count() / compute_sample_coverage_pct()", () => {
  it("estimate_expected_candle_count() computes span/step + 1 for H1, H4, and D1", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
print(json.dumps({
  "h1": c.estimate_expected_candle_count("2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z", "H1"),
  "h4": c.estimate_expected_candle_count("2024-01-01T00:00:00.000Z", "2024-01-05T00:00:00.000Z", "H4"),
  "d1": c.estimate_expected_candle_count("2024-01-01T00:00:00.000Z", "2024-01-11T00:00:00.000Z", "D1"),
}))
`.trim();
    const output = JSON.parse(runPySnippet(py));
    expect(output.h1).toBe(25); // 24h span / 1h step + 1
    expect(output.h4).toBe(25); // 96h span / 4h step + 1
    expect(output.d1).toBe(11); // 10 day span / 1 day step + 1
  });

  it("compute_sample_coverage_pct() returns 100% for a gap-free sample and null for zero rows", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
full = c.compute_sample_coverage_pct(25, "2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z", "H1")
empty = c.compute_sample_coverage_pct(0, "2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z", "H1")
print(json.dumps({"full": full, "empty": empty}))
`.trim();
    const output = JSON.parse(runPySnippet(py));
    expect(output.full).toBe(100.0);
    expect(output.empty).toBeNull();
  });

  it("compute_sample_coverage_pct() reports below 100% when the sample is missing candles within its own first/last span", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
# 13 rows across a 24h/H1 span (25 expected if gap-free) -> 52%
pct = c.compute_sample_coverage_pct(13, "2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z", "H1")
print(json.dumps(pct))
`.trim();
    const output = JSON.parse(runPySnippet(py));
    expect(output).toBeCloseTo(52.0, 1);
  });
});

describe.skipIf(!hasPython3())("MT5 HISTORICAL DISCOVERY — end-to-end pipeline over synthetic bars (mirrors _discover_one's internals)", () => {
  it("hash is deterministic, computed ONLY over valid bars, and changes when a valid bar's price changes but not when only an already-invalid bar changes", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c

def pipeline(bars):
    v = c.validate_ohlc_bars(bars)
    return c.compute_dataset_hash(v["valid"]) if v["valid"] else None

base = [
  {"timestamp": "2024-01-01T00:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100},
  {"timestamp": "2024-01-01T01:00:00.000Z", "open": 1.11, "high": 1.13, "low": 1.10, "close": 1.12, "volume": 90},
  {"timestamp": "2024-01-01T02:00:00.000Z", "open": 1.5, "high": 1.0, "low": 2.0, "close": 1.5, "volume": 10},  # invalid: high<low etc.
]
h1 = pipeline(base)
h2 = pipeline(base)  # same input -> same hash

changed_valid = [dict(b) for b in base]
changed_valid[0] = dict(changed_valid[0], close=1.115)
h3 = pipeline(changed_valid)  # changed a VALID bar -> different hash

changed_invalid_only = [dict(b) for b in base]
changed_invalid_only[2] = dict(changed_invalid_only[2], volume=999)  # still invalid, still excluded
h4 = pipeline(changed_invalid_only)  # only the excluded bar changed -> SAME hash as h1

print(json.dumps({"h1": h1, "h2": h2, "h3": h3, "h4": h4}))
`.trim();
    const output = JSON.parse(runPySnippet(py));
    expect(output.h1).toMatch(/^[0-9a-f]{64}$/);
    expect(output.h1).toBe(output.h2);
    expect(output.h1).not.toBe(output.h3);
    expect(output.h1).toBe(output.h4);
  });

  it("duplicate detection and gap classification run over the RAW sample (including any invalid bars), producing metadata consistent with the discovery report's fields", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c

sample = [
  {"timestamp": "2026-08-03T00:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100},
  {"timestamp": "2026-08-03T00:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100},  # duplicate
  {"timestamp": "2026-08-03T01:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100},
  {"timestamp": "2026-08-07T21:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100},  # weekend gap follows
  {"timestamp": "2026-08-10T00:00:00.000Z", "open": 1.1, "high": 1.12, "low": 1.09, "close": 1.11, "volume": 100},
]
duplicate_count = c.count_duplicates(sample)
gaps = c.list_gap_intervals(sample, "H1")
tally = {}
for g in gaps:
    tally[g["classification"]] = tally.get(g["classification"], 0) + 1
print(json.dumps({"duplicate_count": duplicate_count, "gap_count": len(gaps), "tally": tally}))
`.trim();
    const output = JSON.parse(runPySnippet(py));
    expect(output.duplicate_count).toBe(1);
    expect(output.gap_count).toBeGreaterThanOrEqual(1);
    expect(output.tally.weekend_close).toBeGreaterThanOrEqual(1);
  });

  it("the discovery report's metadata field names (symbol/timeframe/broker/server/retrieved_at/hash/gap summary) are all present in _discover_one's return dict — matches the provenance convention", () => {
    const source = readFileSync(DISCOVERY_FILE, "utf8");
    for (const field of ["\"symbol\"", "\"timeframe\"", "\"broker\"", "\"server\"", "\"retrieved_at\"", "\"dataset_hash\"", "\"sample_gap_classification\"", "\"sample_duplicate_count\"", "\"earliest_available\"", "\"latest_available\"", "\"source\""]) {
      expect(source).toContain(field);
    }
  });

  it("regression: the console summary line never crashes when a sample has zero valid bars (sample_coverage_pct is None) — guarded before formatting with :.1f", () => {
    const source = readFileSync(DISCOVERY_FILE, "utf8");
    expect(source).toMatch(/coverage is not None/);
    expect(source).not.toMatch(/result\['sample_coverage_pct'\]:\.1f/);
  });

  it("never fills or interpolates missing candles — list_gap_intervals only ever counts a gap, the returned bar list length always matches the input length", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
sample = [
  {"timestamp": "2026-08-03T00:00:00.000Z"},
  {"timestamp": "2026-08-03T04:00:00.000Z"},
]
gaps = c.list_gap_intervals(sample, "H1")
print(json.dumps({"input_len": len(sample), "gap_missing": gaps[0]["missing"] if gaps else None}))
`.trim();
    const output = JSON.parse(runPySnippet(py));
    expect(output.input_len).toBe(2); // list_gap_intervals never adds/removes bars from the caller's own list
    expect(output.gap_missing).toBe(3); // 3 missing candles reported, never fabricated
  });
});

describe("MT5 HISTORICAL DISCOVERY — mt5_data_connector.py additions are structurally read-only too", () => {
  it("probe_earliest_bar/probe_latest_bar/get_recent_bars never call order_send or symbol_select", () => {
    const source = readFileSync(CONNECTOR_FILE, "utf8");
    expect(source).not.toMatch(/mt5\.order_send\(/);
    expect(source).not.toMatch(/mt5\.symbol_select\(/);
    // Sanity: the new functions actually exist in this file.
    expect(source).toContain("def probe_earliest_bar(");
    expect(source).toContain("def probe_latest_bar(");
    expect(source).toContain("def get_recent_bars(");
    expect(source).toContain("def validate_ohlc_bars(");
  });
});
