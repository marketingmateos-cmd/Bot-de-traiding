import { describe, expect, it } from "vitest";
import { resolveInternalSymbol, resolveExchangeSymbol, BINANCE_SYMBOL_MAPPINGS } from "../symbolMapping";

describe("Fase 9 test #14 — mapeo explícito BTC/ETH/SOL <-> BTCUSDT/ETHUSDT/SOLUSDT", () => {
  it("maps BTCUSDT -> BTC with quote currency USDT", () => {
    const mapping = resolveInternalSymbol("BTCUSDT");
    expect(mapping.internalSymbol).toBe("BTC");
    expect(mapping.quoteCurrency).toBe("USDT");
    expect(mapping.exchange).toBe("binance");
  });

  it("maps ETHUSDT -> ETH and SOLUSDT -> SOL", () => {
    expect(resolveInternalSymbol("ETHUSDT").internalSymbol).toBe("ETH");
    expect(resolveInternalSymbol("SOLUSDT").internalSymbol).toBe("SOL");
  });

  it("resolves the exchange symbol back from the internal symbol (round-trip)", () => {
    for (const m of BINANCE_SYMBOL_MAPPINGS) {
      expect(resolveExchangeSymbol(m.internalSymbol).exchangeSymbol).toBe(m.exchangeSymbol);
    }
  });

  it("NEVER assumes BTCUSD is equivalent to BTCUSDT — throws on an unmapped quote currency", () => {
    expect(() => resolveInternalSymbol("BTCUSD")).toThrow(/no hay un mapeo/i);
  });

  it("throws a descriptive error for any symbol with no explicit mapping, rather than guessing", () => {
    expect(() => resolveInternalSymbol("DOGEUSDT")).toThrow(/DOGEUSDT/);
    expect(() => resolveExchangeSymbol("DOGE")).toThrow(/DOGE/);
  });

  it("is case-insensitive on the exchange symbol lookup only (never on the mapping table itself)", () => {
    expect(resolveInternalSymbol("btcusdt").internalSymbol).toBe("BTC");
  });
});
