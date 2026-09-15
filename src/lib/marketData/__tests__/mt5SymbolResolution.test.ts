import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const PYTHON_DIR = "python";
const CONNECTOR_FILE = `${PYTHON_DIR}/mt5_data_connector.py`;
const DISCOVERY_FILE = `${PYTHON_DIR}/mt5_historical_discovery.py`;
const RESOLUTION_FILE = `${PYTHON_DIR}/mt5_symbol_resolution.py`;

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

describe("MT5 SYMBOL RESOLUTION — structural read-only safety guard", () => {
  it("mt5_symbol_resolution.py never calls order_send/positions_get/position_close/symbol_select — only mentions them in prose, never as a real call", () => {
    expect(existsSync(RESOLUTION_FILE)).toBe(true);
    const source = readFileSync(RESOLUTION_FILE, "utf8");
    expect(source).not.toMatch(/order_send\(/);
    expect(source).not.toMatch(/positions_get\(/);
    expect(source).not.toMatch(/position_close\(/);
    expect(source).not.toMatch(/symbol_select\(/);
  });

  it("never writes to the database — no Prisma/SQL import, no ResearchDataset creation, purely a read-only report", () => {
    const source = readFileSync(RESOLUTION_FILE, "utf8");
    expect(source).not.toMatch(/prisma/i);
    expect(source).not.toMatch(/INSERT INTO/i);
    expect(source).not.toMatch(/registerResearchDataset/);
  });

  it("never prints MT5_PASSWORD or a raw password variable", () => {
    const source = readFileSync(RESOLUTION_FILE, "utf8");
    expect(source).not.toMatch(/print\([^)]*password/i);
  });

  it("checks the ENABLE_DEMO_EXECUTION kill switch before reading any credential", () => {
    const source = readFileSync(RESOLUTION_FILE, "utf8");
    const killSwitchIdx = source.indexOf("assert_execution_disabled_or_raise");
    const configIdx = source.indexOf("get_mt5_config()");
    expect(killSwitchIdx).toBeGreaterThan(-1);
    expect(configIdx).toBeGreaterThan(-1);
    expect(killSwitchIdx).toBeLessThan(configIdx);
  });

  it("reuses discover_symbol_timeframe() from mt5_historical_discovery.py instead of duplicating the probe/sample/validate pipeline", () => {
    const source = readFileSync(RESOLUTION_FILE, "utf8");
    expect(source).toContain("from mt5_historical_discovery import discover_symbol_timeframe");
    expect(source).toContain("discover_symbol_timeframe(");
    // Sanity: the function it imports actually exists and is public (no leading underscore) in that file.
    const discoverySource = readFileSync(DISCOVERY_FILE, "utf8");
    expect(discoverySource).toContain("def discover_symbol_timeframe(");
  });
});

describe.skipIf(!hasPython3())("MT5 SYMBOL RESOLUTION — execution kill switch aborts before anything else", () => {
  it("aborts immediately, exit code 1, when ENABLE_DEMO_EXECUTION=true — never reaches the credential check", () => {
    const { output, exitCode } = runPython(RESOLUTION_FILE, {
      ENABLE_DEMO_EXECUTION: "true",
      MT5_LOGIN: "",
      MT5_PASSWORD: "",
      MT5_SERVER: "",
    });
    expect(exitCode).toBe(1);
    expect(output).toMatch(/ENABLE_DEMO_EXECUTION is true — refusing to run/);
    expect(output).not.toMatch(/MT5 configuration is incomplete/);
  });

  it("rejects an unsupported timeframe before ever touching credentials or connecting", () => {
    const { output, exitCode } = runPython(RESOLUTION_FILE, { MT5_LOGIN: "1", MT5_PASSWORD: "x", MT5_SERVER: "Demo" }, ["--timeframes", "M5"]);
    expect(exitCode).toBe(1);
    expect(output).toMatch(/Unsupported timeframe: 'M5'/);
    expect(output).not.toMatch(/Login:/);
  });
});

describe.skipIf(!hasPython3())("MT5 SYMBOL RESOLUTION — resolve_canonical_symbol() (broker metadata, never a hardcoded guess)", () => {
  it("resolves an EXACT name match first, before trying startswith/contains", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
symbols = [
  {"name": "EURUSD", "path": "FX\\\\Majors\\\\EURUSD"},
  {"name": "EURUSD.pro", "path": "FX\\\\Majors\\\\EURUSD.pro"},
]
print(json.dumps(c.resolve_canonical_symbol("EURUSD", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.tier).toBe("exact");
    expect(result.resolved).toBe("EURUSD");
  });

  it("resolves a broker-suffixed name (EURUSDm) via the 'startswith' tier when no exact match exists — the real case reported in the broker's FX MB Pro category", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
symbols = [
  {"name": "EURUSDm", "path": "FX MB Pro\\\\EURUSDm"},
  {"name": "GBPUSDm", "path": "FX MB Pro\\\\GBPUSDm"},
]
print(json.dumps(c.resolve_canonical_symbol("EURUSD", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.tier).toBe("startswith");
    expect(result.resolved).toBe("EURUSDm");
    expect(result.path).toBe("FX MB Pro\\EURUSDm");
  });

  it("resolves a PREFIXED name (#EURUSD) only via the last-resort 'contains' tier", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
symbols = [{"name": "#EURUSD", "path": "Legacy\\\\#EURUSD"}]
print(json.dumps(c.resolve_canonical_symbol("EURUSD", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.tier).toBe("contains");
    expect(result.resolved).toBe("#EURUSD");
  });

  it("reports found:null (never invents a symbol) when nothing matches, and empty candidates", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
symbols = [{"name": "GBPUSD", "path": "FX\\\\GBPUSD"}]
print(json.dumps(c.resolve_canonical_symbol("USDJPY", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.resolved).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it("ambiguous broker naming (multiple startswith matches) reports ALL candidates, picks the shortest name deterministically, and is stable across repeated calls", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
symbols = [
  {"name": "EURUSD.pro", "path": "FX\\\\EURUSD.pro"},
  {"name": "EURUSDm", "path": "FX\\\\EURUSDm"},
  {"name": "EURUSD_i", "path": "FX\\\\EURUSD_i"},
]
r1 = c.resolve_canonical_symbol("EURUSD", symbols)
r2 = c.resolve_canonical_symbol("EURUSD", symbols)
print(json.dumps({"r1": r1, "same": r1 == r2}))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.r1.candidates).toHaveLength(3);
    expect(result.r1.resolved).toBe("EURUSDm"); // shortest name wins the tie-break
    expect(result.same).toBe(true); // deterministic, not "whichever the list order happens to be"
  });

  it("never matches a name that merely shares a currency but isn't the same pair (e.g. GBPUSD does not resolve when asking for EURUSD)", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_data_connector as c
symbols = [{"name": "GBPUSD.pro", "path": "FX\\\\GBPUSD.pro"}]
print(json.dumps(c.resolve_canonical_symbol("EURUSD", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.resolved).toBeNull();
  });
});

describe.skipIf(!hasPython3())("MT5 SYMBOL RESOLUTION — XAUUSD/GOLD alternate-spelling fallback (_resolve_root in the script itself)", () => {
  it("falls back to GOLD when XAUUSD isn't found under that exact root, reporting which alternate matched", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_symbol_resolution as r
symbols = [{"name": "GOLD.pro", "path": "Metals\\\\GOLD.pro"}]
print(json.dumps(r._resolve_root("XAUUSD", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.resolved).toBe("GOLD.pro");
    expect(result.matched_alternate).toBe("GOLD");
    expect(result.alternates_tried).toEqual(["XAUUSD", "GOLD"]);
    expect(result.root).toBe("XAUUSD"); // reported under the originally-requested canonical name
  });

  it("prefers XAUUSD over GOLD when both exist on this broker", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_symbol_resolution as r
symbols = [{"name": "XAUUSD.pro", "path": "Metals\\\\XAUUSD.pro"}, {"name": "GOLD.pro", "path": "Metals\\\\GOLD.pro"}]
print(json.dumps(r._resolve_root("XAUUSD", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.resolved).toBe("XAUUSD.pro");
    expect(result.matched_alternate).toBe("XAUUSD");
  });

  it("reports not-found with both alternates listed when neither XAUUSD nor GOLD exist", () => {
    const py = `
import sys, json
sys.path.insert(0, "${PYTHON_DIR}")
import mt5_symbol_resolution as r
symbols = [{"name": "EURUSD", "path": "FX\\\\EURUSD"}]
print(json.dumps(r._resolve_root("XAUUSD", symbols)))
`.trim();
    const result = JSON.parse(runPySnippet(py));
    expect(result.resolved).toBeNull();
    expect(result.alternates_tried).toEqual(["XAUUSD", "GOLD"]);
  });
});

describe.skipIf(!hasPython3())("MT5 SYMBOL RESOLUTION — provenance/metadata field names", () => {
  it("resolve_canonical_symbol()'s result carries mt5_symbol/tier/path/candidates — the fields the resolution script reports and audits", () => {
    const source = readFileSync(CONNECTOR_FILE, "utf8");
    for (const field of ['"root"', '"resolved"', '"mt5_symbol"', '"tier"', '"path"', '"candidates"']) {
      expect(source).toContain(field);
    }
  });

  it("the resolution script's per-pair result carries the same provenance fields as historical discovery, plus resolution_tier/resolution_path", () => {
    const source = readFileSync(RESOLUTION_FILE, "utf8");
    for (const field of ['"resolution_tier"', '"resolution_path"', '"broker"', '"server"', '"retrieved_at"']) {
      expect(source).toContain(field);
    }
  });
});
