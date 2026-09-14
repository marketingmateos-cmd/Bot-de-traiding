import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSymbolMapping, listSymbolMappings, resolveMt5Symbol, setSymbolMapping } from "../mt5SymbolMapper";
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
