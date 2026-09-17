import { atr, ema, rsi } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia C — Cruce de Medias con Momentum (candidata FTMO). A
 * diferencia de `trendFollowingBaseline.ts` (que dispara en CADA vela donde
 * fastMA != slowMA, un estado persistente), esta estrategia exige un cruce
 * REAL: la vela ANTERIOR debe tener fastEMA <= slowEMA (o >=) y la vela
 * ACTUAL debe tener fastEMA > slowEMA (o <) — una señal disparada por
 * EVENTO, no por estado, deliberadamente más selectiva (menos operaciones,
 * mayor convicción por señal — coherente con "rentabilidad moderada y
 * constante" en vez de sobre-operar). El cruce se confirma con momentum
 * (RSI por encima/debajo de su línea media) para descartar cruces sin
 * empuje real detrás. Stop ATR, RRR modesto (1.4).
 */
export const maCrossMomentumFtmoStrategy: StrategyDefinition = {
  id: "ma-cross-momentum-ftmo-v1",
  kind: "MOMENTUM",
  name: "Cruce de Medias con Momentum FTMO (Candidata C)",
  version: "1.0",
  defaultParams: { fastPeriod: 10, slowPeriod: 30, momentumPeriod: 14, momentumThreshold: 50, volatilityPeriod: 14, atrMultiplier: 1.3, rrr: 1.4 },
  timeframe: "H1",
  // Un cruce de medias es, por construcción, una señal de tendencia ya
  // establecida — misma restricción que trendFollowing.ts original.
  recommendedRegimes: ["STRONG_BULL", "BULL", "BEAR", "STRONG_BEAR"],
  defaultStopLossPct: 1.3,
  defaultTakeProfitPct: 1.82,
  defaultTrailingStopPct: null,
  costModel: FTMO_COST_MODEL,
  evaluate(bars, features, params) {
    const fastPeriod = Number(params.fastPeriod ?? 10);
    const slowPeriod = Number(params.slowPeriod ?? 30);
    const momentumPeriod = Number(params.momentumPeriod ?? 14);
    const momentumThreshold = Number(params.momentumThreshold ?? 50);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const atrMultiplier = Number(params.atrMultiplier ?? 1.3);
    const rrr = Number(params.rrr ?? 1.4);

    // +2 (no +1): necesitamos DOS puntos válidos consecutivos de EMA lenta
    // (vela anterior y vela actual) para poder detectar un cruce real,
    // nunca solo el estado de la vela actual.
    if (bars.length < slowPeriod + 2) return null;

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

    // Cruce alcista: la EMA rápida pasa de <= a > la EMA lenta EN ESTA vela.
    const bullishCross = fastPrev <= slowPrev && fastNow > slowNow;
    // Cruce bajista: simétrico.
    const bearishCross = fastPrev >= slowPrev && fastNow < slowNow;

    if (bullishCross && rsiValue > momentumThreshold) {
      return {
        kind: "MOMENTUM",
        direction: "LONG",
        strength: Math.min(1, (rsiValue - momentumThreshold) / (100 - momentumThreshold) + 0.3),
        reason: `Cruce alcista: EMA(${fastPeriod}) ${fastNow.toFixed(2)} superó a EMA(${slowPeriod}) ${slowNow.toFixed(2)} en esta vela, CON RSI(${momentumPeriod})=${rsiValue.toFixed(1)} por encima de ${momentumThreshold} (momentum alcista confirmado).`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { fastEma: fastNow, slowEma: slowNow, rsi: rsiValue, stopDistance, rrr },
      };
    }
    if (bearishCross && rsiValue < 100 - momentumThreshold) {
      return {
        kind: "MOMENTUM",
        direction: "SHORT",
        strength: Math.min(1, (100 - momentumThreshold - rsiValue) / (100 - momentumThreshold) + 0.3),
        reason: `Cruce bajista: EMA(${fastPeriod}) ${fastNow.toFixed(2)} cayó por debajo de EMA(${slowPeriod}) ${slowNow.toFixed(2)} en esta vela, CON RSI(${momentumPeriod})=${rsiValue.toFixed(1)} por debajo de ${100 - momentumThreshold} (momentum bajista confirmado).`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { fastEma: fastNow, slowEma: slowNow, rsi: rsiValue, stopDistance, rrr },
      };
    }
    // Un cruce SIN momentum confirmatorio (o momentum sin cruce fresco) se
    // descarta — nunca se relaja el requisito de "ambas condiciones a la vez".
    return null;
  },
};
