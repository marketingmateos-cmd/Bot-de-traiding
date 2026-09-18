import { atr, ema, rsi } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia C v2.1 — Cruce de Medias con Momentum + Filtro ATR relajado
 * (evolución de `maCrossMomentumFtmoV2.ts`, registrada por separado — v2
 * NUNCA se sobrescribe ni se modifica, sigue disponible para comparar; v1
 * tampoco se toca). Idéntica a v2 en TODO excepto un único parámetro:
 * `atrFilterMultiplier` baja de 1.0 (100% de la media de ATR reciente) a
 * 0.75 (75%).
 *
 * Motivo, a partir de la evidencia REAL de v2 (backtest sobre BTC/ETH H1,
 * mismas 2 ventanas de 12 meses ya usadas para v1 y v2): el filtro ATR de
 * v2 descartó el 75% de las señales brutas de cruce+momentum (38 de 51),
 * incluida la ÚNICA señal del año en BTC-alcista (dejando 0 operaciones
 * esa ventana) — un umbral de "al menos el 100% de la media reciente" es
 * más estricto que una entrada institucional típica, que a menudo ocurre
 * cuando la volatilidad ya está REPUNTANDO desde un mínimo reciente pero
 * aún no ha alcanzado ni superado su propia media — es decir, v2 rechazaba
 * sistemáticamente el inicio del repunte de volatilidad, no solo los
 * rangos genuinamente muertos. Bajar el umbral a 0.75× mantiene el
 * propósito original del filtro (seguir descartando rangos muertos de
 * volatilidad claramente por debajo de lo normal) sin exigir que la
 * volatilidad ya haya vuelto POR COMPLETO a su media antes de aceptar una
 * señal — una relajación estructural, no un ajuste para maximizar ningún
 * resultado concreto ya visto (el propio backtest de v2.1 no se ha
 * ejecutado todavía en el momento de escribir esto).
 *
 * El Stop Loss ATR, el Take Profit dinámico por intensidad de momentum y
 * el trailing stop son EXACTAMENTE los mismos que v2 — no se tocan.
 */
export const maCrossMomentumFtmoV2_1Strategy: StrategyDefinition = {
  id: "ma-cross-momentum-ftmo-v2-1",
  kind: "MOMENTUM",
  name: "Cruce de Medias con Momentum FTMO v2.1 (Candidata C — Filtro ATR 0.75x + TP Dinámico)",
  version: "2.1",
  defaultParams: {
    fastPeriod: 10,
    slowPeriod: 30,
    momentumPeriod: 14,
    momentumThreshold: 50,
    volatilityPeriod: 14,
    atrMultiplier: 1.3,
    atrFilterPeriod: 20,
    // Único cambio respecto a v2 (era 1): exige que el ATR de la vela de
    // activación sea al menos el 75% de la media de su propio ATR reciente,
    // en vez del 100% — permite capturar cruces al inicio de un repunte de
    // volatilidad, no solo una vez que la volatilidad ya ha vuelto por
    // completo a su media.
    atrFilterMultiplier: 0.75,
    baseRrr: 1.4,
    momentumRrrBonus: 1.2,
  },
  timeframe: "H1",
  // Misma restricción que v1/v2: un cruce de medias es, por construcción,
  // una señal de tendencia ya establecida.
  recommendedRegimes: ["STRONG_BULL", "BULL", "BEAR", "STRONG_BEAR"],
  defaultStopLossPct: 1.3,
  // Idéntico a v2 — el punto medio del rango dinámico [1.4, 2.6] no cambia,
  // el único parámetro modificado en v2.1 es atrFilterMultiplier.
  defaultTakeProfitPct: 2.6,
  defaultTrailingStopPct: 1.3,
  costModel: FTMO_COST_MODEL,
  evaluate(bars, features, params) {
    const fastPeriod = Number(params.fastPeriod ?? 10);
    const slowPeriod = Number(params.slowPeriod ?? 30);
    const momentumPeriod = Number(params.momentumPeriod ?? 14);
    const momentumThreshold = Number(params.momentumThreshold ?? 50);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const atrMultiplier = Number(params.atrMultiplier ?? 1.3);
    const atrFilterPeriod = Number(params.atrFilterPeriod ?? 20);
    const atrFilterMultiplier = Number(params.atrFilterMultiplier ?? 0.75);
    const baseRrr = Number(params.baseRrr ?? 1.4);
    const momentumRrrBonus = Number(params.momentumRrrBonus ?? 1.2);

    // +2 (no +1): necesitamos DOS puntos válidos consecutivos de EMA lenta
    // (vela anterior y vela actual) para detectar un cruce real. Además
    // necesitamos `atrFilterPeriod` valores de ATR ESTRICTAMENTE anteriores
    // a la vela actual para el filtro de volatilidad mínima.
    const minBars = Math.max(slowPeriod + 2, volatilityPeriod + atrFilterPeriod + 1);
    if (bars.length < minBars) return null;

    const closes = bars.map((b) => b.close);
    const fastArr = ema(closes, fastPeriod);
    const slowArr = ema(closes, slowPeriod);
    const n = closes.length;
    const fastNow = fastArr[n - 1];
    const slowNow = slowArr[n - 1];
    const fastPrev = fastArr[n - 2];
    const slowPrev = slowArr[n - 2];
    if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null) return null;

    const rsiArr = rsi(closes, momentumPeriod);
    const rsiValue = rsiArr[rsiArr.length - 1];
    if (rsiValue === null) return null;

    const current = bars[bars.length - 1];
    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    // Filtro de volatilidad mínima (relajado a 0.75x en v2.1): el ATR de la
    // vela de activación debe igualar o superar el 75% de la media de su
    // propio ATR reciente — la ventana EXCLUYE la vela actual (misma regla
    // de no-lookahead que el resto del repositorio).
    const priorAtrWindow = atrArr.slice(-atrFilterPeriod - 1, -1).filter((v): v is number => v !== null);
    if (priorAtrWindow.length < atrFilterPeriod) return null;
    const atrFloor = (priorAtrWindow.reduce((a, b) => a + b, 0) / priorAtrWindow.length) * atrFilterMultiplier;
    if (atrValue < atrFloor) return null; // rango muerto — volatilidad por debajo del 75% de lo normal, se descarta

    const bullishCross = fastPrev <= slowPrev && fastNow > slowNow;
    const bearishCross = fastPrev >= slowPrev && fastNow < slowNow;

    if (bullishCross && rsiValue > momentumThreshold) {
      const momentumIntensity = Math.min(1, (rsiValue - momentumThreshold) / (100 - momentumThreshold));
      const dynamicRrr = baseRrr + momentumIntensity * momentumRrrBonus;
      return {
        kind: "MOMENTUM",
        direction: "LONG",
        strength: Math.min(1, momentumIntensity + 0.3),
        reason: `Cruce alcista: EMA(${fastPeriod}) ${fastNow.toFixed(2)} superó a EMA(${slowPeriod}) ${slowNow.toFixed(2)} en esta vela, CON RSI(${momentumPeriod})=${rsiValue.toFixed(1)} por encima de ${momentumThreshold}, ATR(${volatilityPeriod})=${atrValue.toFixed(2)} >= 75% de la media reciente (filtro de rango muerto relajado superado); TP dinámico RRR=${dynamicRrr.toFixed(2)}.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * dynamicRrr,
        meta: { fastEma: fastNow, slowEma: slowNow, rsi: rsiValue, stopDistance, rrr: dynamicRrr, atrFloor },
      };
    }
    if (bearishCross && rsiValue < 100 - momentumThreshold) {
      const momentumIntensity = Math.min(1, (100 - momentumThreshold - rsiValue) / (100 - momentumThreshold));
      const dynamicRrr = baseRrr + momentumIntensity * momentumRrrBonus;
      return {
        kind: "MOMENTUM",
        direction: "SHORT",
        strength: Math.min(1, momentumIntensity + 0.3),
        reason: `Cruce bajista: EMA(${fastPeriod}) ${fastNow.toFixed(2)} cayó por debajo de EMA(${slowPeriod}) ${slowNow.toFixed(2)} en esta vela, CON RSI(${momentumPeriod})=${rsiValue.toFixed(1)} por debajo de ${100 - momentumThreshold}, ATR(${volatilityPeriod})=${atrValue.toFixed(2)} >= 75% de la media reciente (filtro de rango muerto relajado superado); TP dinámico RRR=${dynamicRrr.toFixed(2)}.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * dynamicRrr,
        meta: { fastEma: fastNow, slowEma: slowNow, rsi: rsiValue, stopDistance, rrr: dynamicRrr, atrFloor },
      };
    }
    // Un cruce SIN momentum confirmatorio, o en un rango de volatilidad por
    // debajo del 75% de su propia media reciente, se descarta — nunca se
    // relaja ninguno de los tres requisitos (cruce fresco + momentum +
    // volatilidad mínima) a la vez.
    return null;
  },
};
