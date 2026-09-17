import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MT5 REAL BRIDGE — regression coverage for `registry.ts`'s env-gated
 * selection between the sidecar client and the safe default. The single
 * most important property here: with NEITHER env var set (every existing
 * environment, including this sandbox, and every deployment that hasn't
 * configured a sidecar), behavior must be byte-for-byte unchanged from
 * before this bridge existed.
 */

const ORIGINAL_URL = process.env.MT5_SIDECAR_URL;
const ORIGINAL_TOKEN = process.env.MT5_SIDECAR_TOKEN;

async function freshRegistry() {
  // registry.ts holds a module-level singleton — each test needs a truly
  // fresh module instance to observe a different env-var configuration,
  // since resolveMt5Client() only runs once per singleton lifetime.
  vi.resetModules();
  return import("../registry");
}

beforeEach(() => {
  delete process.env.MT5_SIDECAR_URL;
  delete process.env.MT5_SIDECAR_TOKEN;
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.MT5_SIDECAR_URL;
  else process.env.MT5_SIDECAR_URL = ORIGINAL_URL;
  if (ORIGINAL_TOKEN === undefined) delete process.env.MT5_SIDECAR_TOKEN;
  else process.env.MT5_SIDECAR_TOKEN = ORIGINAL_TOKEN;
});

describe("getMt5ExecutionAdapter() — default behavior is unchanged with no sidecar configured", () => {
  it("with both env vars unset, login() still reports the exact 'not available' message from createUnavailableMt5Client()", async () => {
    const { getMt5ExecutionAdapter } = await freshRegistry();
    const result = await getMt5ExecutionAdapter().connect({ login: "1", password: "x", server: "Demo" });
    expect(result.connected).toBe(false);
    expect(result.error).toMatch(/MetaTrader 5 no está disponible en este entorno/);
  });

  it("with only MT5_SIDECAR_URL set (token missing), still falls back to the unavailable client — both are required, neither alone is enough", async () => {
    process.env.MT5_SIDECAR_URL = "http://127.0.0.1:47822";
    const { getMt5ExecutionAdapter } = await freshRegistry();
    const result = await getMt5ExecutionAdapter().connect({ login: "1", password: "x", server: "Demo" });
    expect(result.error).toMatch(/MetaTrader 5 no está disponible en este entorno/);
  });

  it("with only MT5_SIDECAR_TOKEN set (url missing), still falls back to the unavailable client", async () => {
    process.env.MT5_SIDECAR_TOKEN = "some-token";
    const { getMt5ExecutionAdapter } = await freshRegistry();
    const result = await getMt5ExecutionAdapter().connect({ login: "1", password: "x", server: "Demo" });
    expect(result.error).toMatch(/MetaTrader 5 no está disponible en este entorno/);
  });
});

describe("getMt5ExecutionAdapter() — sidecar client wired only when BOTH env vars are set", () => {
  it("with both set, connect() attempts an HTTP call to the configured URL rather than short-circuiting to the unavailable message", async () => {
    process.env.MT5_SIDECAR_URL = "http://127.0.0.1:1"; // deliberately unreachable — proves an HTTP attempt was made, not that it succeeds
    process.env.MT5_SIDECAR_TOKEN = "some-token";
    const { getMt5ExecutionAdapter } = await freshRegistry();
    const result = await getMt5ExecutionAdapter().connect({ login: "1", password: "x", server: "Demo" });
    // A real transport-failure message from mt5SidecarClient.ts, never the
    // createUnavailableMt5Client() literal — proves the sidecar path was taken.
    expect(result.error).not.toMatch(/MetaTrader 5 no está disponible en este entorno/);
    expect(result.error).toMatch(/sidecar MT5/);
  });
});

describe("setMt5ExecutionAdapterForTesting() — unaffected by this change", () => {
  it("still overrides the singleton regardless of env configuration", async () => {
    const { getMt5ExecutionAdapter, setMt5ExecutionAdapterForTesting } = await freshRegistry();
    const fake = { id: "fake" } as ReturnType<typeof getMt5ExecutionAdapter>;
    setMt5ExecutionAdapterForTesting(fake);
    expect(getMt5ExecutionAdapter()).toBe(fake);
    setMt5ExecutionAdapterForTesting(null);
  });
});
