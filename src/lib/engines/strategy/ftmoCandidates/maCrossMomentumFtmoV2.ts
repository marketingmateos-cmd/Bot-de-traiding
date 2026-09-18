import { atr, ema, rsi } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia C v2 — Cruce de Medias con Momentum + Filtro ATR + TP dinámico
 * (evolución de `maCrossMomentumFtmo.ts` v1, registrada por separado — v1
 * NUNCA se sobrescribe ni se modifica, sigue disponible para comparar).
 *
 * Mantiene INTACTO el núcleo de v1 (cruce de EMA(fastPeriod/slowPeriod)
 * disparado por EVENTO, nunca por estado persistente, confirmado con
 * RSI(momentumPeriod) respecto a `momentumThreshold`) y añade DOS mejoras
 * estructurales, ninguna ajustada mirando resultados de backtest ya vistos:
 *
 * 1) FILTRO DE VOLATILIDAD MÍNIMA EN EL GATILLO: en la vela del cruce, el
 *    ATR(volatilityPeriod) actual debe ser >= la media de su propio ATR de
 *    las `atrFilterPeriod` velas ESTRICTAMENTE anteriores (nunca la vela
 *    actual) × `atrFilterMultiplier`. Se usa un umbral RELATIVO al propio
 *    historial reciente del activo — no un número absoluto — porque un
 *    umbral fijo en unidades de precio no generaliza entre activos de
 *    escala distinta (BTC vs ETH); comparar el ATR contra su propia media
 *    reciente descarta cruces en "rangos muertos" (volatilidad por debajo
 *    de lo normal) sin necesitar re-calibrar por instrumento.
 * 2) TAKE PROFIT DINÁMICO POR INTENSIDAD DE MOMENTUM: en vez de un RRR fijo
 *    (v1 usaba 1.4 constante), el RRR efectivo escala entre `baseRrr` y
 *    `baseRrr + momentumRrrBonus` según cuán lejos está el RSI de
 *    `momentumThreshold` (saturado en 1 cuando el RSI toca el extremo
 *    100/0) — una confirmación de momentum más fuerte obtiene un objetivo
 *    más ambicioso (dejar correr las ganancias en los cruces de más
 *    convicción), una confirmación marginal obtiene un objetivo más
 *    conservador (tomar beneficio antes cuando el edge es más débil). El
 *    Stop Loss sigue siendo EXACTAMENTE el mismo cálculo ATR×atrMultiplier
 *    que v1 — no se toca ("mantener el SL basado en ATR").
 *
 * `defaultTrailingStopPct` (null en v1) se activa aquí con la misma
 * magnitud que `defaultStopLossPct`, para que el motor de backtesting
 * estático (`backtest.ts`, panel /backtesting) también proteja beneficio
 * ya conseguido sin capar el trade al primer RRR alcanzado — el motor de
 * replay (`historicalReplayEngine.ts`, Strategy Lab) usa además el
 * `stopLossPrice`/`takeProfitPrice` reales por señal calculados abajo, que
 * ya son dinámicos por construcción (dependen del ATR y del RSI de cada
 * señal concreta, no de una constante global).
 */
export const maCrossMomentumFtmoV2Strategy: StrategyDefinition = {
  id: "ma-cross-momentum-ftmo-v2",
  kind: "MOMENTUM",
  name: "Cruce de Medias con Momentum FTMO v2 (Candidata C — Filtro ATR + TP Dinámico)",
  version: "2.0",
  defaultParams: {
    fastPeriod: 10,
    slowPeriod: 30,
    momentumPeriod: 14,
    momentumThreshold: 50,
    volatilityPeriod: 14,
    atrMultiplier: 1.3,
    atrFilterPeriod: 20,
    atrFilterMultiplier: 1,
    baseRrr: 1.4,
    momentumRrrBonus: 1.2,
  },
  timeframe: "H1",
  // Misma restricción que v1: un cruce de medias es, por construcción, una
  // señal de tendencia ya establecida.
  recommendedRegimes: ["STRONG_BULL", "BULL", "BEAR", "STRONG_BEAR"],
  defaultStopLossPct: 1.3,
  // Punto medio del rango dinámico [baseRrr, baseRrr+momentumRrrBonus] =
  // [1.4, 2.6] → 2.0, usado solo como aproximación estática para el motor
  // de backtesting simple (panel /backtesting); el motor de replay usa el
  // RRR realmente dinámico calculado por señal más abajo.
  defaultTakeProfitPct: 2.6,
  // Misma magnitud que el Stop Loss: una vez que el trade progresa, la
  // vela más reciente nunca puede retroceder más de un stopDistance desde
  // su máximo/mínimo favorable sin cerrar — protege beneficio ya
  // conseguido en vez de devolverlo todo antes de tocar el TP ampliado.
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
    const atrFilterMultiplier = Number(params.atrFilterMultiplier ?? 1);
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

    // Filtro de volatilidad mínima: el ATR de la vela de activación debe
    // igualar o superar la media de su propio ATR reciente — la ventana
    // EXCLUYE la vela actual (misma regla de no-lookahead que el resto del
    // repositorio: nunca comparar la vela actual contra sí misma).
    const priorAtrWindow = atrArr.slice(-atrFilterPeriod - 1, -1).filter((v): v is number => v !== null);
    if (priorAtrWindow.length < atrFilterPeriod) return null;
    const atrFloor = (priorAtrWindow.reduce((a, b) => a + b, 0) / priorAtrWindow.length) * atrFilterMultiplier;
    if (atrValue < atrFloor) return null; // rango muerto — volatilidad por debajo de lo normal, se descarta

    const bullishCross = fastPrev <= slowPrev && fastNow > slowNow;
    const bearishCross = fastPrev >= slowPrev && fastNow < slowNow;

    if (bullishCross && rsiValue > momentumThreshold) {
      const momentumIntensity = Math.min(1, (rsiValue - momentumThreshold) / (100 - momentumThreshold));
      const dynamicRrr = baseRrr + momentumIntensity * momentumRrrBonus;
      return {
        kind: "MOMENTUM",
        direction: "LONG",
        strength: Math.min(1, momentumIntensity + 0.3),
        reason: `Cruce alcista: EMA(${fastPeriod}) ${fastNow.toFixed(2)} superó a EMA(${slowPeriod}) ${slowNow.toFixed(2)} en esta vela, CON RSI(${momentumPeriod})=${rsiValue.toFixed(1)} por encima de ${momentumThreshold}, ATR(${volatilityPeriod})=${atrValue.toFixed(2)} >= media reciente (filtro de rango muerto superado); TP dinámico RRR=${dynamicRrr.toFixed(2)}.`,
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
        reason: `Cruce bajista: EMA(${fastPeriod}) ${fastNow.toFixed(2)} cayó por debajo de EMA(${slowPeriod}) ${slowNow.toFixed(2)} en esta vela, CON RSI(${momentumPeriod})=${rsiValue.toFixed(1)} por debajo de ${100 - momentumThreshold}, ATR(${volatilityPeriod})=${atrValue.toFixed(2)} >= media reciente (filtro de rango muerto superado); TP dinámico RRR=${dynamicRrr.toFixed(2)}.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * dynamicRrr,
        meta: { fastEma: fastNow, slowEma: slowNow, rsi: rsiValue, stopDistance, rrr: dynamicRrr, atrFloor },
      };
    }
    // Un cruce SIN momentum confirmatorio, o en un rango de volatilidad
    // por debajo de su propia media reciente, se descarta — nunca se
    // relaja ninguno de los tres requisitos (cruce fresco + momentum +
    // volatilidad mínima) a la vez.
    return null;
  },
};
