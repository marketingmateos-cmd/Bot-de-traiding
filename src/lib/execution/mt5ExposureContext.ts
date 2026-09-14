import { prisma } from "@/lib/db";

/**
 * MT5 Fase 2 — exposure/concentration bookkeeping for the MT5 Demo
 * account's OWN open positions, kept deliberately separate from
 * `paperTradingEngine.ts`'s equivalent bookkeeping for `PaperPosition`
 * (they are two different accounts with two different equity curves).
 * Feeds straight into the EXISTING `checkExposureLimits` (riskEngine.ts) —
 * reused, not reimplemented.
 *
 * Known Phase 2 simplification (documented, not silent): notional is
 * approximated as `volume * entryPrice` rather than
 * `volume * contractSize * entryPrice`, since contractSize would require
 * an extra per-symbol spec lookup for every currently-open position on
 * every candidate. This is directionally correct for standard
 * one-unit-per-lot instruments and is a real limitation for instruments
 * with an unusual contract size — see docs/mt5-demo-integration.md.
 * Correlation against MT5 positions is not computed in Phase 2 either
 * (no bar history is fetched for arbitrary MT5 symbols yet) —
 * `correlatedOpenNotional` is always 0, which makes the CORRELATION_OK
 * checklist item a pass-through until a real implementation lands.
 */
export interface Mt5ExposureContext {
  openPositionCount: number;
  openNotional: number;
  assetOpenNotional: number; // for the ONE candidate symbol being evaluated
}

export async function computeMt5ExposureContext(mt5Symbol: string): Promise<Mt5ExposureContext> {
  const positions = await prisma.mt5DemoPosition.findMany();
  const openNotional = positions.reduce((sum, p) => sum + p.volume * p.entryPrice, 0);
  const assetOpenNotional = positions.filter((p) => p.symbol === mt5Symbol).reduce((sum, p) => sum + p.volume * p.entryPrice, 0);
  return { openPositionCount: positions.length, openNotional, assetOpenNotional };
}
