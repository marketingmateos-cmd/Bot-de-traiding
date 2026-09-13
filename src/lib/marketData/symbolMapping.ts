/**
 * Fase 9 — explicit exchange-symbol <-> internal-symbol mapping. Never
 * inferred, never assumed: this project's internal `Asset.symbol` is a
 * bare asset code ("BTC"), but every real exchange trades a specific
 * QUOTE-currency PAIR ("BTCUSDT" on Binance is not the same instrument as
 * "BTCUSD" or "BTCUSDC" — different quote currency, different price
 * series, different history). Collapsing that distinction silently would
 * make "BTC" mean a different, unstated thing depending on which pair
 * happened to be imported last. This map is the single place that
 * decision is made explicit and auditable.
 */
export interface ExchangeSymbolMapping {
  exchange: "binance";
  exchangeSymbol: string; // e.g. "BTCUSDT" — exactly what the exchange API expects
  internalSymbol: string; // e.g. "BTC" — matches Asset.symbol
  quoteCurrency: string; // e.g. "USDT" — documented, never assumed equivalent to USD
}

// Fase 9's first dataset only. Adding a new asset/pair means adding an
// explicit row here — there is no fallback that guesses a pair from a bare
// symbol.
export const BINANCE_SYMBOL_MAPPINGS: ExchangeSymbolMapping[] = [
  { exchange: "binance", exchangeSymbol: "BTCUSDT", internalSymbol: "BTC", quoteCurrency: "USDT" },
  { exchange: "binance", exchangeSymbol: "ETHUSDT", internalSymbol: "ETH", quoteCurrency: "USDT" },
  { exchange: "binance", exchangeSymbol: "SOLUSDT", internalSymbol: "SOL", quoteCurrency: "USDT" },
];

export function resolveInternalSymbol(exchangeSymbol: string): ExchangeSymbolMapping {
  const mapping = BINANCE_SYMBOL_MAPPINGS.find((m) => m.exchangeSymbol === exchangeSymbol.toUpperCase());
  if (!mapping) {
    throw new Error(
      `No hay un mapeo explícito para el símbolo de Binance "${exchangeSymbol}" — añade una entrada en BINANCE_SYMBOL_MAPPINGS antes de importar. Nunca se asume una correspondencia implícita (p. ej. BTCUSDT != BTCUSD).`
    );
  }
  return mapping;
}

export function resolveExchangeSymbol(internalSymbol: string): ExchangeSymbolMapping {
  const mapping = BINANCE_SYMBOL_MAPPINGS.find((m) => m.internalSymbol === internalSymbol.toUpperCase());
  if (!mapping) {
    throw new Error(`No hay un mapeo explícito de Binance para el símbolo interno "${internalSymbol}".`);
  }
  return mapping;
}
