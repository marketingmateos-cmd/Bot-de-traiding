import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSymbolMapping, listSymbolMappings, resolveMt5Symbol, setSymbolMapping, discoverMt5Symbols } from "../mt5SymbolMapper";
import { makeFakeMt5Client } from "./testFixtures";
import { MT5DemoExecutionAdapter } from "../mt5DemoExecutionAdapter";

async function resetMappings() {
  await prisma.mt5SymbolMapping.deleteMany({ where: { edgeLabSymbol: { startsWith: "SYMTEST_" } } });
}

beforeEach(resetMappings);
afterEach(resetMappings);

describe("MT5 Fase 2, spec section 5 — symbol mapping CRUD", () => {
  it("setSymbolMapping creates and getSymbolMapping reads it back", async () => {
    await setSymbolMapping("SYMTEST_BTC", "BTCUSDm");
    const row = await getSymbolMapping("SYMTEST_BTC");
    expect(row?.mt5Symbol).toBe("BTCUSDm");
    expect(row?.enabled).toBe(true);
  });

  it("setSymbolMapping upserts (overwrites) an existing mapping", async () => {
    await setSymbolMapping("SYMTEST_BTC", "BTCUSD");
    await setSymbolMapping("SYMTEST_BTC", "BTCUSDT");
    const row = await getSymbolMapping("SYMTEST_BTC");
    expect(row?.mt5Symbol).toBe("BTCUSDT");
  });

  it("listSymbolMappings includes every configured mapping, alphabetically", async () => {
    await setSymbolMapping("SYMTEST_ZZZ", "ZZZm");
    await setSymbolMapping("SYMTEST_AAA", "AAAm");
    const rows = await listSymbolMappings();
    const testRows = rows.filter((r) => r.edgeLabSymbol.startsWith("SYMTEST_"));
    expect(testRows.map((r) => r.edgeLabSymbol)).toEqual(["SYMTEST_AAA", "SYMTEST_ZZZ"]);
  });
});

describe("MT5 Fase 2, spec section 5 — resolveMt5Symbol: exact match", () => {
  it("resolves an EdgeLab symbol whose mapped MT5 symbol matches exactly and is available live", async () => {
    await setSymbolMapping("SYMTEST_EURUSD", "EURUSD");
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSD", "GBPUSD"] }));
    const result = await resolveMt5Symbol("SYMTEST_EURUSD", adapter);
    expect(result).toEqual({ ok: true, mt5Symbol: "EURUSD" });
  });
});

describe("MT5 Fase 2, spec section 5 — resolveMt5Symbol: broker suffix", () => {
  it("resolves EdgeLab 'XAUUSD' to a broker-suffixed 'XAUUSDm' — names are never assumed equal", async () => {
    await setSymbolMapping("SYMTEST_XAUUSD", "XAUUSDm");
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["XAUUSDm", "EURUSDm"] }));
    const result = await resolveMt5Symbol("SYMTEST_XAUUSD", adapter);
    expect(result).toEqual({ ok: true, mt5Symbol: "XAUUSDm" });
  });

  it("distinct EdgeLab symbols (BTC vs BTCUSDT) can map to entirely different broker symbols", async () => {
    await setSymbolMapping("SYMTEST_BTC", "BTCUSD");
    await setSymbolMapping("SYMTEST_BTCUSDT", "BTCUSDTm");
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["BTCUSD", "BTCUSDTm"] }));
    expect(await resolveMt5Symbol("SYMTEST_BTC", adapter)).toEqual({ ok: true, mt5Symbol: "BTCUSD" });
    expect(await resolveMt5Symbol("SYMTEST_BTCUSDT", adapter)).toEqual({ ok: true, mt5Symbol: "BTCUSDTm" });
  });
});

describe("MT5 Fase 2, spec section 5 — resolveMt5Symbol: unavailable symbol", () => {
  it("rejects when there is no mapping at all — never guesses a name", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSD"] }));
    const result = await resolveMt5Symbol("SYMTEST_UNMAPPED", adapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/No hay un mapeo/);
  });

  it("rejects when the mapping exists but is disabled", async () => {
    await setSymbolMapping("SYMTEST_DISABLED", "DISABLEDm", false);
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["DISABLEDm"] }));
    const result = await resolveMt5Symbol("SYMTEST_DISABLED", adapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/deshabilitado/);
  });

  it("rejects when the mapped MT5 symbol is not in the live terminal's symbol list — a mapping valid yesterday is not trusted blindly", async () => {
    await setSymbolMapping("SYMTEST_REMOVED", "REMOVEDm");
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["OTHERSYMBOL"] }));
    const result = await resolveMt5Symbol("SYMTEST_REMOVED", adapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no está disponible/);
  });
});

describe("MT5 Data Connector, spec section 6 — discoverMt5Symbols", () => {
  it("finds a known broker symbol on the first candidate and persists the mapping", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSD", "XAUUSD"] }));
    const results = await discoverMt5Symbols(adapter, { SYMTEST_EURUSD: ["EURUSD"], SYMTEST_XAUUSD: ["XAUUSD", "GOLD"] });
    expect(results).toEqual(
      expect.arrayContaining([
        { edgeLabSymbol: "SYMTEST_EURUSD", found: true, mt5Symbol: "EURUSD", candidatesTried: ["EURUSD"] },
        { edgeLabSymbol: "SYMTEST_XAUUSD", found: true, mt5Symbol: "XAUUSD", candidatesTried: ["XAUUSD", "GOLD"] },
      ])
    );
    const row = await getSymbolMapping("SYMTEST_EURUSD");
    expect(row?.mt5Symbol).toBe("EURUSD");
  });

  it("falls back to a later candidate when the first isn't available on this broker (broker-specific naming)", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["SPX500", "GER40"] }));
    const results = await discoverMt5Symbols(adapter, { SYMTEST_US500: ["US500", "SPX500", "US500.cash"], SYMTEST_DAX: ["DAX", "GER40"] });
    expect(results.find((r) => r.edgeLabSymbol === "SYMTEST_US500")).toEqual({ edgeLabSymbol: "SYMTEST_US500", found: true, mt5Symbol: "SPX500", candidatesTried: ["US500", "SPX500", "US500.cash"] });
    expect(results.find((r) => r.edgeLabSymbol === "SYMTEST_DAX")).toEqual({ edgeLabSymbol: "SYMTEST_DAX", found: true, mt5Symbol: "GER40", candidatesTried: ["DAX", "GER40"] });
  });

  it("ambiguous mapping — when MULTIPLE candidates exist on the broker, the FIRST one in the candidate list wins, deterministically", async () => {
    // A broker that happens to expose BOTH "US500" and "SPX500" — the
    // candidate list order (not alphabetical, not "most recently seen")
    // is what decides it, and it's the same result every time.
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["SPX500", "US500"] }));
    const results = await discoverMt5Symbols(adapter, { SYMTEST_US500: ["US500", "SPX500"] });
    expect(results).toEqual([{ edgeLabSymbol: "SYMTEST_US500", found: true, mt5Symbol: "US500", candidatesTried: ["US500", "SPX500"] }]);

    // Re-running with the SAME inputs must be deterministic — never
    // "whichever the terminal happens to answer first".
    const again = await discoverMt5Symbols(adapter, { SYMTEST_US500: ["US500", "SPX500"] });
    expect(again).toEqual(results);
  });

  it("reports found:false (never invents a symbol) when no candidate exists on this broker", async () => {
    const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => ["EURUSD"] }));
    const results = await discoverMt5Symbols(adapter, { SYMTEST_NAS100: ["NAS100", "USTEC"] });
    expect(results).toEqual([{ edgeLabSymbol: "SYMTEST_NAS100", found: false, mt5Symbol: null, candidatesTried: ["NAS100", "USTEC"] }]);
    const row = await getSymbolMapping("SYMTEST_NAS100");
    expect(row).toBeNull(); // never persists a mapping for something it didn't actually find
  });
});
