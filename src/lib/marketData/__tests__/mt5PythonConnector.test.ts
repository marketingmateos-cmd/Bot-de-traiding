import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { computeDatasetHash } from "@/lib/research/researchDataset";

const PYTHON_DIR = "python";
const CONNECTOR_FILE = `${PYTHON_DIR}/mt5_data_connector.py`;
const TEST_SCRIPT_FILE = `${PYTHON_DIR}/mt5_connection_test.py`;

function hasPython3(): boolean {
  try {
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
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

  it("neither Python file ever prints MT5_PASSWORD or a raw password variable", () => {
    for (const file of [CONNECTOR_FILE, TEST_SCRIPT_FILE]) {
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
});
