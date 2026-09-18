import { trendBreakoutFtmoStrategy } from "./trendBreakoutFtmo";
import { meanReversionFtmoStrategy } from "./meanReversionFtmo";
import { maCrossMomentumFtmoStrategy } from "./maCrossMomentumFtmo";
import { maCrossMomentumFtmoV2Strategy } from "./maCrossMomentumFtmoV2";
import { maCrossMomentumFtmoV2_1Strategy } from "./maCrossMomentumFtmoV2_1";
import { momentumBreakoutFtmoStrategy } from "./momentumBreakoutFtmo";
import { momentumBreakoutFtmoV2Strategy } from "./momentumBreakoutFtmoV2";
import type { StrategyDefinition } from "../types";

/**
 * Multi-Estrategias Candidatas para Backtesting y Filtrado FTMO — 4
 * familias (Tendencia/Breakout, Reversión a la Media, Cruce de Medias con
 * Momentum, Apex Breakout), todas orientadas a rentabilidad MODERADA y
 * CONSTANTE con riesgo bajo por operación (stop ATR ajustado, RRR modesto
 * o asimétrico según la familia).
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
  // v2 y v2.1 se AÑADEN junto a v1 — ninguna versión anterior se sobrescribe
  // ni se elimina, para poder comparar las tres directamente en
  // Backtesting/Strategy Lab.
  maCrossMomentumFtmoV2Strategy,
  maCrossMomentumFtmoV2_1Strategy,
  momentumBreakoutFtmoStrategy,
  // v2 se AÑADE junto a v1 — v1 nunca se sobrescribe ni se elimina.
  momentumBreakoutFtmoV2Strategy,
];

export {
  trendBreakoutFtmoStrategy,
  meanReversionFtmoStrategy,
  maCrossMomentumFtmoStrategy,
  maCrossMomentumFtmoV2Strategy,
  maCrossMomentumFtmoV2_1Strategy,
  momentumBreakoutFtmoStrategy,
  momentumBreakoutFtmoV2Strategy,
};
export { FTMO_HYPOTHESIS_REGISTRY, getFtmoHypothesis } from "./hypothesisRegistry";
