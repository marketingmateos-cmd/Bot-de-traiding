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
