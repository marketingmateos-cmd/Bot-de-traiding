import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MT5DemoExecutionAdapter } from "../mt5DemoExecutionAdapter";
import { verifyAccountIsDemo, canEnableMt5Execution, LIVE_ACCOUNT_BLOCKED_MESSAGE } from "../demoAccountGuard";
import { getConnectionRow, setExecutionEnabled } from "../mt5ConnectionStore";
import { createUnavailableMt5Client } from "../mt5Client";
import { redactSecret, maskIdentifier } from "../secretRedaction";
import { DEMO_ACCOUNT, LIVE_ACCOUNT, UNKNOWN_TYPE_ACCOUNT, makeFakeMt5Client } from "./testFixtures";

const TEST_SECRET_PASSWORD = "hunter2-super-secret";

async function resetConnectionRow() {
  await prisma.mT5DemoConnection.deleteMany({ where: { id: "main" } });
}
async function cleanupExecutionEvents(symbol: string) {
  await prisma.executionEvent.deleteMany({ where: { symbol } });
}

// MT5 Data Connector phase added an additional env-level kill switch
// (ENABLE_DEMO_EXECUTION) on top of everything these Fase MT5.1/2 tests
// already exercise. Before that phase, there was no env gate at all —
// equivalent to always-on — so this file opts every test into that
// equivalent state, and adds its OWN dedicated tests (below) for the
// env-gate-specifically-off behavior. Restored after every test so no
// state leaks into other test files.
const ORIGINAL_ENABLE_DEMO_EXECUTION = process.env.ENABLE_DEMO_EXECUTION;
beforeEach(() => {
  process.env.ENABLE_DEMO_EXECUTION = "true";
});
afterEach(() => {
  if (ORIGINAL_ENABLE_DEMO_EXECUTION === undefined) delete process.env.ENABLE_DEMO_EXECUTION;
  else process.env.ENABLE_DEMO_EXECUTION = ORIGINAL_ENABLE_DEMO_EXECUTION;
});

beforeEach(resetConnectionRow);
afterEach(resetConnectionRow);

describe("Fase MT5.1 — verifyAccountIsDemo() (pure guard)", () => {
  it("DEMO account accepted", () => {
    expect(verifyAccountIsDemo(DEMO_ACCOUNT)).toBe(true);
  });

  it("TEST: live account → execution rejected at the verification step", () => {
    expect(verifyAccountIsDemo(LIVE_ACCOUNT)).toBe(false);
  });

  it("an unrecognized/missing account type is treated as NOT demo, never assumed safe", () => {
    expect(verifyAccountIsDemo(UNKNOWN_TYPE_ACCOUNT)).toBe(false);
  });

  it("missing account information (null) is rejected", () => {
    expect(verifyAccountIsDemo(null)).toBe(false);
  });
});

describe("Fase MT5.1 — MT5DemoExecutionAdapter.connect()", () => {
  it("TEST: demo account → valid connection accepted, persisted with verifiedDemo=true", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ accountInfo: async () => DEMO_ACCOUNT }));
    const result = await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });

    expect(result.connected).toBe(true);
    expect(result.error).toBeNull();

    const row = await getConnectionRow();
    expect(row?.status).toBe("CONNECTED");
    expect(row?.verifiedDemo).toBe(true);
    expect(row?.accountType).toBe("DEMO");
    expect(row?.executionEnabled).toBe(false); // OFF by default, section 16
  });

  it("live account is connected at the transport level but flagged as blocked, never marked verifiedDemo", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ accountInfo: async () => LIVE_ACCOUNT }));
    const result = await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Live" });

    expect(result.error).toBe(LIVE_ACCOUNT_BLOCKED_MESSAGE);

    const row = await getConnectionRow();
    expect(row?.verifiedDemo).toBe(false);
    expect(row?.accountType).toBe("LIVE");
    expect(row?.executionEnabled).toBe(false);
  });

  it("missing account information (login ok but accountInfo() null) is rejected, never silently treated as demo", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ accountInfo: async () => null }));
    const result = await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });

    expect(result.connected).toBe(false);
    expect(result.error).not.toBeNull();

    const row = await getConnectionRow();
    expect(row?.status).toBe("ERROR");
  });

  it("a rejected login (bad credentials) never connects and never verifies demo", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ login: async () => ({ ok: false, error: "invalid credentials" }) }));
    const result = await adapter.connect({ login: "0000000", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });

    expect(result.connected).toBe(false);
    const row = await getConnectionRow();
    expect(row?.status).toBe("ERROR");
    expect(row?.verifiedDemo).toBeFalsy();
  });

  it("disconnected terminal is reported honestly by getTerminalInfo, never fabricated as connected", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ isConnected: async () => false }));
    const info = await adapter.getTerminalInfo();
    expect(info.connected).toBe(false);
    expect(info.latencyMs).toBeNull();
  });

  it("the shipped default (createUnavailableMt5Client) never pretends a real MT5 terminal is reachable from this environment", async () => {
    const adapter = new MT5DemoExecutionAdapter(createUnavailableMt5Client());
    const result = await adapter.connect({ login: "1", password: TEST_SECRET_PASSWORD, server: "x" });
    expect(result.connected).toBe(false);
    expect(result.error).toMatch(/MetaTrader 5 no está disponible/);
  });
});

describe("Fase MT5.1, spec section 22 — credentials are never logged or persisted", () => {
  it("credentials never logged: no console call during a failing connect ever contains the password", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Adversarial: the fake client's error message itself contains the
    // password, simulating a buggy/hostile lower layer — the adapter must
    // still redact it before it can reach anywhere observable.
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ login: async () => ({ ok: false, error: `auth failed for password ${TEST_SECRET_PASSWORD}` }) }));
    const result = await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });

    const allConsoleText = JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(allConsoleText).not.toContain(TEST_SECRET_PASSWORD);
    expect(result.error).not.toContain(TEST_SECRET_PASSWORD);
    expect(result.error).toContain("[REDACTED]");

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("credentials never persisted in Prisma: no field of the MT5DemoConnection row ever contains the password, on success or failure", async () => {
    const successAdapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await successAdapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    const rowAfterSuccess = await getConnectionRow();
    expect(Object.keys(rowAfterSuccess ?? {})).not.toContain("password");
    expect(JSON.stringify(rowAfterSuccess)).not.toContain(TEST_SECRET_PASSWORD);

    await resetConnectionRow();

    const failingAdapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ login: async () => ({ ok: false, error: `bad password ${TEST_SECRET_PASSWORD}` }) }));
    await failingAdapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    const rowAfterFailure = await getConnectionRow();
    expect(JSON.stringify(rowAfterFailure)).not.toContain(TEST_SECRET_PASSWORD);
  });

  it("redactSecret removes every occurrence of a secret from a string, never a partial/prefix leak", () => {
    expect(redactSecret(`error: ${TEST_SECRET_PASSWORD} rejected, retry with ${TEST_SECRET_PASSWORD}`, TEST_SECRET_PASSWORD)).toBe("error: [REDACTED] rejected, retry with [REDACTED]");
  });

  it("maskIdentifier never reveals a full login id, only a short suffix", () => {
    expect(maskIdentifier("1234567")).toBe("•••••67");
    expect(maskIdentifier(null)).toBe("—");
  });
});

describe("Fase MT5.1, spec section 16 — execution disabled by default, Safety Switch", () => {
  it("execution disabled by default: a freshly connected DEMO account cannot place orders until explicitly enabled", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });

    const result = await adapter.placeOrder({ symbol: "EURUSD_DISABLED_TEST", side: "BUY", volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "disabled-by-default-test" });
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toMatch(/Safety Switch OFF/);
    await cleanupExecutionEvents("EURUSD_DISABLED_TEST");
  });

  it("TEST: live account → execution rejected even if executionEnabled were somehow true (defense in depth)", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ accountInfo: async () => LIVE_ACCOUNT }));
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Live" });
    await setExecutionEnabled(true); // simulate a bug/tamper attempt elsewhere flipping the flag

    const result = await adapter.placeOrder({ symbol: "EURUSD_LIVE_TEST", side: "BUY", volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "live-blocked-test" });
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe(LIVE_ACCOUNT_BLOCKED_MESSAGE);
    await cleanupExecutionEvents("EURUSD_LIVE_TEST");
  });

  it("TEST: demo account → valid execution allowed once the connection is verified demo AND execution is explicitly enabled", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    await setExecutionEnabled(true);

    const result = await adapter.placeOrder({ symbol: "EURUSD_ALLOWED_TEST", side: "BUY", volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "allowed-test" });
    expect(result.status).toBe("FILLED");
    expect(result.ticket).toBe("999");

    const event = await prisma.executionEvent.findUnique({ where: { idempotencyKey: "allowed-test" } });
    expect(event?.status).toBe("FILLED");
    expect(event?.symbol).toBe("EURUSD_ALLOWED_TEST");
    await cleanupExecutionEvents("EURUSD_ALLOWED_TEST");
  });

  it("canEnableMt5Execution refuses when disconnected", async () => {
    const result = await canEnableMt5Execution({ connectionStatus: "DISCONNECTED", verifiedDemo: false });
    expect(result.allowed).toBe(false);
    expect(result.reasons.some((r) => r.includes("no está conectado"))).toBe(true);
  });

  it("canEnableMt5Execution refuses a connected-but-not-verified-demo account with the exact required message", async () => {
    const result = await canEnableMt5Execution({ connectionStatus: "CONNECTED", verifiedDemo: false });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(LIVE_ACCOUNT_BLOCKED_MESSAGE);
  });

  it("canEnableMt5Execution refuses when a circuit breaker is tripped", async () => {
    await prisma.circuitBreaker.upsert({
      where: { name: "mt5-test-breaker" },
      create: { name: "mt5-test-breaker", kind: "MAX_DAILY_LOSS", threshold: "5", isTripped: true, trippedReason: "test trip" },
      update: { isTripped: true, trippedReason: "test trip" },
    });
    const result = await canEnableMt5Execution({ connectionStatus: "CONNECTED", verifiedDemo: true });
    expect(result.allowed).toBe(false);
    expect(result.reasons.some((r) => r.includes("mt5-test-breaker"))).toBe(true);
    await prisma.circuitBreaker.delete({ where: { name: "mt5-test-breaker" } });
  });

  it("canEnableMt5Execution allows when connected, verified demo, and no breaker tripped", async () => {
    const result = await canEnableMt5Execution({ connectionStatus: "CONNECTED", verifiedDemo: true });
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("reconnection resets the Safety Switch: a fresh connect after a disconnect never inherits executionEnabled=true", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    await setExecutionEnabled(true);
    expect((await getConnectionRow())?.executionEnabled).toBe(true);

    await adapter.disconnect();
    expect((await getConnectionRow())?.executionEnabled).toBe(false);

    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    expect((await getConnectionRow())?.executionEnabled).toBe(false);
  });
});

describe("Fase MT5.1, spec section 18 — duplicate order protection", () => {
  it("the same idempotencyKey can never place two orders, across a simulated retry", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    await setExecutionEnabled(true);

    const request = { symbol: "EURUSD_DUP_TEST", side: "BUY" as const, volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "duplicate-guard-test" };
    const first = await adapter.placeOrder(request);
    const second = await adapter.placeOrder(request); // simulated retry of the exact same signal

    expect(first.status).toBe("FILLED");
    expect(second.status).toBe("REJECTED");
    expect(second.rejectionReason).toMatch(/duplicada/i);

    const rows = await prisma.executionEvent.findMany({ where: { idempotencyKey: "duplicate-guard-test" } });
    expect(rows).toHaveLength(1); // never a second row for the same key

    await cleanupExecutionEvents("EURUSD_DUP_TEST");
  });
});

describe("Fase MT5.1, spec section 23 — AI is not authority over this gate", () => {
  it("PlaceOrderRequest and the eligibility check have no AI-shaped field to smuggle an approval through", async () => {
    // Structural proof: canEnableMt5Execution's return is derived ONLY
    // from connectionStatus/verifiedDemo/circuit-breaker state. Casting in
    // an extra "aiApproved" property (as an adversarial caller might try)
    // has zero effect, because the function never reads any such field.
    const withSmuggledField = await canEnableMt5Execution({ connectionStatus: "CONNECTED", verifiedDemo: false, aiApproved: true } as never);
    expect(withSmuggledField.allowed).toBe(false);
    expect(withSmuggledField.reasons).toContain(LIVE_ACCOUNT_BLOCKED_MESSAGE);
  });

  it("a LIVE account cannot be placed regardless of any 'confidence'-shaped extra data on the request", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ accountInfo: async () => LIVE_ACCOUNT }));
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Live" });
    await setExecutionEnabled(true);

    const result = await adapter.placeOrder({ symbol: "EURUSD_AI_TEST", side: "BUY", volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "ai-cannot-bypass-test", aiConfidence: 0.99 } as never);
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe(LIVE_ACCOUNT_BLOCKED_MESSAGE);
    await cleanupExecutionEvents("EURUSD_AI_TEST");
  });
});

describe("MT5 Data Connector — getHistoricalBars() (READ, never touches execution state)", () => {
  it("delegates straight to the client and returns bars as-is, ascending", async () => {
    const bars = [
      { timestamp: new Date("2024-01-01T00:00:00.000Z"), open: 1.1, high: 1.12, low: 1.09, close: 1.11, volume: 100, tickVolume: 100, spread: 2, realVolume: 0 },
      { timestamp: new Date("2024-01-01T01:00:00.000Z"), open: 1.11, high: 1.13, low: 1.1, close: 1.12, volume: 120, tickVolume: 120, spread: 2, realVolume: 0 },
    ];
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ historicalRates: async () => bars }));
    const result = await adapter.getHistoricalBars("EURUSD", "H1", new Date("2024-01-01T00:00:00.000Z"), new Date("2024-01-01T02:00:00.000Z"));
    expect(result).toEqual(bars);
  });

  it("does not require CONNECTED/verifiedDemo/executionEnabled state — a pure passthrough read, unlike placeOrder", async () => {
    // No connect() call at all — the fake client still answers, proving this method never consults MT5DemoConnection.
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ historicalRates: async () => [] }));
    const result = await adapter.getHistoricalBars("EURUSD", "H1", new Date(), new Date());
    expect(result).toEqual([]);
  });

  it("the default createUnavailableMt5Client() reports historical bars honestly as empty, never fabricated", async () => {
    const adapter = new MT5DemoExecutionAdapter(createUnavailableMt5Client());
    const result = await adapter.getHistoricalBars("EURUSD", "H1", new Date(), new Date());
    expect(result).toEqual([]);
  });
});

describe("MT5 Data Connector — ENABLE_DEMO_EXECUTION env kill switch (spec section 3)", () => {
  const ORIGINAL = process.env.ENABLE_DEMO_EXECUTION;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ENABLE_DEMO_EXECUTION;
    else process.env.ENABLE_DEMO_EXECUTION = ORIGINAL;
  });

  it("false (unset) => execution impossible even when connected, verified demo, AND the DB Safety Switch is on", async () => {
    delete process.env.ENABLE_DEMO_EXECUTION;
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    await setExecutionEnabled(true);

    const result = await adapter.placeOrder({ symbol: "EURUSD_ENVGATE_TEST", side: "BUY", volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "env-gate-off-test" });
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe("Demo execution is disabled");
    await cleanupExecutionEvents("EURUSD_ENVGATE_TEST");
  });

  it("any value other than the literal 'true' is treated as false", async () => {
    process.env.ENABLE_DEMO_EXECUTION = "1";
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    await setExecutionEnabled(true);

    const result = await adapter.placeOrder({ symbol: "EURUSD_ENVGATE_TEST2", side: "BUY", volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "env-gate-truthy-string-test" });
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe("Demo execution is disabled");
    await cleanupExecutionEvents("EURUSD_ENVGATE_TEST2");
  });

  it("false at the env level ALSO blocks canEnableMt5Execution from ever setting the DB flag to true in the first place", async () => {
    delete process.env.ENABLE_DEMO_EXECUTION;
    const result = await canEnableMt5Execution({ connectionStatus: "CONNECTED", verifiedDemo: true });
    expect(result.allowed).toBe(false);
    expect(result.reasons.some((r) => r.includes("ENABLE_DEMO_EXECUTION"))).toBe(true);
  });

  it("true (both env AND DB flag) is required together — env true alone, with the DB flag still off, is still refused", async () => {
    process.env.ENABLE_DEMO_EXECUTION = "true";
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client());
    await adapter.connect({ login: "1234567", password: TEST_SECRET_PASSWORD, server: "TestBroker-Demo" });
    // deliberately never calling setExecutionEnabled(true)

    const result = await adapter.placeOrder({ symbol: "EURUSD_ENVGATE_TEST3", side: "BUY", volume: 0.1, stopLoss: 1.05, takeProfit: 1.15, idempotencyKey: "env-true-db-false-test" });
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toMatch(/Safety Switch OFF/);
    await cleanupExecutionEvents("EURUSD_ENVGATE_TEST3");
  });

  it("no execution fallback: there is no other exported function anywhere in src/lib/execution/ that calls client.orderSend besides MT5DemoExecutionAdapter.placeOrder", async () => {
    const { execSync } = await import("node:child_process");
    const output = execSync('grep -rn "\\.orderSend(" src/lib/execution/*.ts || true', { cwd: process.cwd() }).toString().trim();
    const lines = output.split("\n").filter(Boolean);
    expect(lines.every((l) => l.includes("mt5DemoExecutionAdapter.ts"))).toBe(true);
  });
});

describe("Fase MT5.1 — architecture separation (spec section 1)", () => {
  it("HistoricalReplay's source tree never imports anything from src/lib/execution/", async () => {
    const { execSync } = await import("node:child_process");
    const output = execSync('grep -rl "lib/execution" src/lib/replay/ || true', { cwd: process.cwd() }).toString().trim();
    expect(output).toBe("");
  });

  it("the pure paper-simulation internals (paperExecution/positionStateManager/positionLifecycle) never import anything from src/lib/execution/ — only paperTradingEngine.ts's own additive MT5 hook may", async () => {
    const { execSync } = await import("node:child_process");
    const output = execSync('grep -rl "lib/execution" src/lib/engines/paperExecution.ts src/lib/engines/positionStateManager.ts src/lib/engines/positionLifecycle.ts 2>/dev/null || true', {
      cwd: process.cwd(),
    })
      .toString()
      .trim();
    expect(output).toBe("");
  });

  it("MT5 Fase 2, spec section 2/19 — paperTradingEngine.ts's ONLY door into src/lib/execution/ is the sanctioned mt5ExecutionOrchestrator hook, never mt5Client/mt5DemoExecutionAdapter/duplicateOrderGuard directly", async () => {
    const { execSync } = await import("node:child_process");
    const imports = execSync('grep -o \'lib/execution/[a-zA-Z0-9_-]*\' src/lib/paperTradingEngine.ts | sort -u', { cwd: process.cwd() }).toString().trim();
    const importedModules = imports.split("\n").filter(Boolean);
    expect(importedModules).toEqual(["lib/execution/mt5ExecutionOrchestrator"]);
  });
});
