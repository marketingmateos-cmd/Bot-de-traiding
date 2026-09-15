import { prisma } from "@/lib/db";
import type { TradingExecutionAdapter } from "./types";

/**
 * MT5 Fase 2, spec section 5 — EdgeLab symbol <-> MT5 broker symbol, never
 * assumed equal. `BTC` might be `BTCUSD`, `BTCUSDT`, or `BTCUSDm` depending
 * entirely on the connected broker; this module is the one place that
 * mapping is looked up, and the one place it's validated against what the
 * broker's terminal actually reports as available right now.
 */

export interface Mt5SymbolMappingRow {
  edgeLabSymbol: string;
  mt5Symbol: string;
  enabled: boolean;
}

export async function getSymbolMapping(edgeLabSymbol: string): Promise<Mt5SymbolMappingRow | null> {
  return prisma.mt5SymbolMapping.findUnique({ where: { edgeLabSymbol } });
}

export async function setSymbolMapping(edgeLabSymbol: string, mt5Symbol: string, enabled = true): Promise<Mt5SymbolMappingRow> {
  return prisma.mt5SymbolMapping.upsert({
    where: { edgeLabSymbol },
    create: { edgeLabSymbol, mt5Symbol, enabled },
    update: { mt5Symbol, enabled },
  });
}

export async function listSymbolMappings(): Promise<Mt5SymbolMappingRow[]> {
  return prisma.mt5SymbolMapping.findMany({ orderBy: { edgeLabSymbol: "asc" } });
}

/**
 * MT5 Data Connector phase, spec section 6 — the initial target instrument
 * list (Forex majors, one metal, three indices), each with a short list of
 * CANDIDATE broker-specific names to try during discovery. The exact name
 * a given broker uses is never assumed — `discoverMt5Symbols` below only
 * ever confirms a candidate against the LIVE terminal's own symbol list
 * (`adapter.getSymbols()`); it never invents a name that isn't in this
 * list and never accepts a name the terminal doesn't actually report.
 */
export const DEFAULT_MT5_SYMBOL_CANDIDATES: Record<string, readonly string[]> = {
  EURUSD: ["EURUSD"],
  GBPUSD: ["GBPUSD"],
  USDJPY: ["USDJPY"],
  XAUUSD: ["XAUUSD", "GOLD"],
  US500: ["US500", "SPX500", "US500.cash", "SP500"],
  NAS100: ["NAS100", "USTEC", "NAS100.cash", "US100"],
  DAX: ["DAX", "GER40", "DE40", "GER30"],
};

export interface Mt5SymbolDiscoveryResult {
  edgeLabSymbol: string;
  found: boolean;
  mt5Symbol: string | null;
  candidatesTried: readonly string[];
}

/**
 * For each `edgeLabSymbol -> candidates[]` entry, tries each candidate (in
 * order) against the LIVE terminal's own `getSymbols()` list, takes the
 * first that actually exists, persists the mapping via `setSymbolMapping`,
 * and reports it. Never guesses a name outside the given candidate list,
 * never marks a symbol "found" without it being echoed back by the
 * terminal itself. A symbol with no matching candidate is reported
 * `found: false` — never silently skipped, never invented.
 */
export async function discoverMt5Symbols(adapter: TradingExecutionAdapter, targets: Record<string, readonly string[]> = DEFAULT_MT5_SYMBOL_CANDIDATES): Promise<Mt5SymbolDiscoveryResult[]> {
  const availableSymbols = new Set(await adapter.getSymbols());
  const results: Mt5SymbolDiscoveryResult[] = [];

  for (const [edgeLabSymbol, candidates] of Object.entries(targets)) {
    const match = candidates.find((c) => availableSymbols.has(c));
    if (match) {
      await setSymbolMapping(edgeLabSymbol, match);
      results.push({ edgeLabSymbol, found: true, mt5Symbol: match, candidatesTried: candidates });
    } else {
      results.push({ edgeLabSymbol, found: false, mt5Symbol: null, candidatesTried: candidates });
    }
  }

  return results;
}

export type ResolveMt5SymbolResult = { ok: true; mt5Symbol: string } | { ok: false; reason: string };

/**
 * Resolves an EdgeLab symbol to its MT5 broker symbol AND confirms, against
 * the LIVE terminal (via `adapter.getSymbols()`), that it currently exists
 * and is enabled — a mapping that was valid yesterday but was removed by
 * the broker (or simply never enabled in this terminal) is rejected, never
 * silently used anyway. Never guesses a symbol name when no explicit
 * mapping exists.
 */
export async function resolveMt5Symbol(edgeLabSymbol: string, adapter: TradingExecutionAdapter): Promise<ResolveMt5SymbolResult> {
  const mapping = await getSymbolMapping(edgeLabSymbol);
  if (!mapping) {
    return { ok: false, reason: `No hay un mapeo MT5 explícito para el símbolo EdgeLab "${edgeLabSymbol}" — añádelo antes de operar. Nunca se asume que el nombre coincide.` };
  }
  if (!mapping.enabled) {
    return { ok: false, reason: `El mapeo de "${edgeLabSymbol}" a "${mapping.mt5Symbol}" está deshabilitado.` };
  }

  const availableSymbols = await adapter.getSymbols();
  if (!availableSymbols.includes(mapping.mt5Symbol)) {
    return { ok: false, reason: `El símbolo "${mapping.mt5Symbol}" (mapeado desde "${edgeLabSymbol}") no está disponible/habilitado en el terminal MT5 conectado.` };
  }

  return { ok: true, mt5Symbol: mapping.mt5Symbol };
}
