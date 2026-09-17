import { atr, sma } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia A — Tendencia/Breakout (candidata FTMO). Reutiliza el mismo
 * núcleo de ruptura que `breakoutBaseline.ts` (cierre rompe el máximo/mínimo
 * de las `lookback` velas ESTRICTAMENTE anteriores, nunca incluyendo la vela
 * actual) pero le añade un filtro de tendencia (SMA `trendFilterPeriod`):
 * solo se acepta una ruptura ALCISTA si el precio ya está por encima de esa
 * media, y solo una ruptura BAJISTA si ya está por debajo — la diferencia
 * deliberada frente al baseline puro, pensada para descartar rupturas
 * contra-tendencia (el modo de fallo más común de un breakout puro en un
 * rango). El stop es ATR con un multiplicador más ajustado (1.2, frente al
 * 1.5 del baseline) y el RRR es más modesto (1.3, frente a 1.5) — riesgo por
 * operación más bajo, objetivo más alcanzable, en línea con "rentabilidad
 * moderada y constante" en vez de perseguir movimientos grandes y poco
 * frecuentes.
 */
export const trendBreakoutFtmoStrategy: StrategyDefinition = {
  id: "trend-breakout-ftmo-v1",
  kind: "BREAKOUT",
  name: "Tendencia/Breakout FTMO (Candidata A)",
  version: "1.0",
  defaultParams: { lookback: 20, trendFilterPeriod: 50, volatilityPeriod: 14, atrMultiplier: 1.2, rrr: 1.3 },
  timeframe: "H1",
  // Una ruptura solo tiene sentido como continuación en un contexto ya
  // direccional — nunca en RANGE/NEUTRAL/LOW_VOLATILITY, donde el filtro de
  // tendencia (SMA50) rara vez estaría alineado con una ruptura genuina.
  recommendedRegimes: ["STRONG_BULL", "BULL", "BEAR", "STRONG_BEAR", "TRANSITION"],
  defaultStopLossPct: 1.2,
  defaultTakeProfitPct: 1.56,
  defaultTrailingStopPct: null,
  costModel: FTMO_COST_MODEL,
  evaluate(bars, features, params) {
    const lookback = Number(params.lookback ?? 20);
    const trendFilterPeriod = Number(params.trendFilterPeriod ?? 50);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const atrMultiplier = Number(params.atrMultiplier ?? 1.2);
    const rrr = Number(params.rrr ?? 1.3);

    const minBars = Math.max(lookback + 1, trendFilterPeriod);
    if (bars.length < minBars) return null;

    const closes = bars.map((b) => b.close);
    const trendArr = sma(closes, trendFilterPeriod);
    const trendMa = trendArr[trendArr.length - 1];
    if (trendMa === null) return null;

    // REGLA ABSOLUTA (igual que breakoutBaseline.ts): la ventana de ruptura
    // excluye la vela actual — nunca compara la vela contra su propio high/low.
    const window = bars.slice(-lookback - 1, -1);
    const highestHigh = Math.max(...window.map((b) => b.high));
    const lowestLow = Math.min(...window.map((b) => b.low));
    const current = bars[bars.length - 1];

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    if (current.close > highestHigh && current.close > trendMa) {
      const stopLossPrice = current.close - stopDistance;
      const takeProfitPrice = current.close + stopDistance * rrr;
      return {
        kind: "BREAKOUT",
        direction: "LONG",
        strength: Math.min(1, 0.5 + (current.close - highestHigh) / Math.max(1e-9, stopDistance)),
        reason: `Ruptura alcista sobre el máximo de ${lookback} velas (${highestHigh.toFixed(2)}) CON filtro de tendencia (close ${current.close.toFixed(2)} > SMA${trendFilterPeriod} ${trendMa.toFixed(2)}); stop ATR(${volatilityPeriod})×${atrMultiplier}.`,
        stopLossPrice,
        takeProfitPrice,
        meta: { breakoutLevel: highestHigh, trendMa, direction: "LONG", stopDistance, rrr },
      };
    }
    if (current.close < lowestLow && current.close < trendMa) {
      const stopLossPrice = current.close + stopDistance;
      const takeProfitPrice = current.close - stopDistance * rrr;
      return {
        kind: "BREAKOUT",
        direction: "SHORT",
        strength: Math.min(1, 0.5 + (lowestLow - current.close) / Math.max(1e-9, stopDistance)),
        reason: `Ruptura bajista bajo el mínimo de ${lookback} velas (${lowestLow.toFixed(2)}) CON filtro de tendencia (close ${current.close.toFixed(2)} < SMA${trendFilterPeriod} ${trendMa.toFixed(2)}); stop ATR(${volatilityPeriod})×${atrMultiplier}.`,
        stopLossPrice,
        takeProfitPrice,
        meta: { breakoutLevel: lowestLow, trendMa, direction: "SHORT", stopDistance, rrr },
      };
    }
    // Nota: una ruptura SIN el filtro de tendencia alineado (p.ej. ruptura
    // alcista con close < SMA50) se descarta deliberadamente — nunca se
    // relaja a "señal débil", simplemente no dispara.
    return null;
  },
};
