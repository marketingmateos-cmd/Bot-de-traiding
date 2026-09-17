import { trendBreakoutFtmoStrategy } from "./trendBreakoutFtmo";
import { meanReversionFtmoStrategy } from "./meanReversionFtmo";
import { maCrossMomentumFtmoStrategy } from "./maCrossMomentumFtmo";
import type { StrategyDefinition } from "../types";

/**
 * Multi-Estrategias Candidatas para Backtesting y Filtrado FTMO — 3
 * familias nuevas (Tendencia/Breakout, Reversión a la Media, Cruce de
 * Medias con Momentum), todas orientadas a rentabilidad MODERADA y
 * CONSTANTE con riesgo bajo por operación (stop ATR ajustado, RRR modesto).
 * Mismo patrón que `../baseline/index.ts` y `../research/index.ts`:
 * deliberadamente NO forman parte de `STRATEGY_REGISTRY` — nunca se
 * ejecutan en el bot de paper trading en vivo ni en el replay "Bot
 * completo" (nunca se seedean en `prisma/seed.ts`), resueltas únicamente
 * vía el fallback de `getStrategyById()`. Son candidatas para
 * Backtesting/Strategy Lab, no estrategias en producción.
 */
export const FTMO_CANDIDATE_STRATEGY_REGISTRY: StrategyDefinition[] = [
  trendBreakoutFtmoStrategy,
  meanReversionFtmoStrategy,
  maCrossMomentumFtmoStrategy,
];

export { trendBreakoutFtmoStrategy, meanReversionFtmoStrategy, maCrossMomentumFtmoStrategy };
export { FTMO_HYPOTHESIS_REGISTRY, getFtmoHypothesis } from "./hypothesisRegistry";
