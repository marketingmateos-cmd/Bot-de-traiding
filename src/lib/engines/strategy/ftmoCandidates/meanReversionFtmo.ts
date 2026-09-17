import { atr, bollingerBands, rsi } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia B — Reversión a la Media (candidata FTMO). Estructuralmente
 * distinta de `meanReversionBaseline.ts` (que usa un z-score puro sobre
 * SMA): aquí el precio debe tocar/cruzar una Banda de Bollinger (mean ±
 * `stdDevMultiplier` desviaciones típicas de `period` velas) Y el RSI debe
 * confirmar una condición de sobrecompra/sobreventa — doble confirmación
 * deliberada para reducir señales marginales (disciplina de riesgo, no solo
 * "más filtros"). El stop es ATR con un multiplicador conservador (1.0) y
 * el objetivo es modesto (RRR 1.2, no "volver a la media" — un objetivo por
 * distancia a la media sería variable y menos comparable/reproducible que
 * un RRR fijo, la misma convención que el resto de estrategias de este
 * repositorio).
 */
export const meanReversionFtmoStrategy: StrategyDefinition = {
  id: "mean-reversion-ftmo-v1",
  kind: "MEAN_REVERSION",
  name: "Reversión a la Media FTMO (Candidata B)",
  version: "1.0",
  defaultParams: { period: 20, stdDevMultiplier: 2, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, volatilityPeriod: 14, atrMultiplier: 1, rrr: 1.2 },
  timeframe: "H1",
  // Misma restricción que meanReversionBaseline original (strategy/meanReversion.ts):
  // la reversión a la media falla sistemáticamente en tendencias fuertes —
  // nunca se recomienda fuera de rangos/baja volatilidad.
  recommendedRegimes: ["RANGE", "NEUTRAL", "LOW_VOLATILITY"],
  defaultStopLossPct: 1,
  defaultTakeProfitPct: 1.2,
  defaultTrailingStopPct: null,
  costModel: FTMO_COST_MODEL,
  evaluate(bars, features, params) {
    const period = Number(params.period ?? 20);
    const stdDevMultiplier = Number(params.stdDevMultiplier ?? 2);
    const rsiPeriod = Number(params.rsiPeriod ?? 14);
    const rsiOversold = Number(params.rsiOversold ?? 30);
    const rsiOverbought = Number(params.rsiOverbought ?? 70);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const atrMultiplier = Number(params.atrMultiplier ?? 1);
    const rrr = Number(params.rrr ?? 1.2);

    const minBars = Math.max(period, rsiPeriod + 1) + 1;
    if (bars.length < minBars) return null;

    const closes = bars.map((b) => b.close);
    const bands = bollingerBands(closes, period, stdDevMultiplier);
    const upper = bands.upper[bands.upper.length - 1];
    const lower = bands.lower[bands.lower.length - 1];
    const mid = bands.mid[bands.mid.length - 1];
    if (upper === null || lower === null || mid === null) return null;

    const rsiArr = rsi(closes, rsiPeriod);
    const rsiValue = rsiArr[rsiArr.length - 1];
    if (rsiValue === null) return null;

    const current = bars[bars.length - 1];
    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    // Doble confirmación: precio en/bajo la banda inferior Y RSI en zona de
    // sobreventa — cualquiera de las dos sola se descarta.
    if (current.close <= lower && rsiValue <= rsiOversold) {
      return {
        kind: "MEAN_REVERSION",
        direction: "LONG",
        strength: Math.min(1, (rsiOversold - rsiValue) / rsiOversold + 0.3),
        reason: `Close ${current.close.toFixed(2)} en/bajo banda inferior de Bollinger (${lower.toFixed(2)}, media ${mid.toFixed(2)}) CON RSI(${rsiPeriod})=${rsiValue.toFixed(1)} en sobreventa (<=${rsiOversold}).`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { bandLevel: lower, bbMid: mid, rsi: rsiValue, stopDistance, rrr },
      };
    }
    if (current.close >= upper && rsiValue >= rsiOverbought) {
      return {
        kind: "MEAN_REVERSION",
        direction: "SHORT",
        strength: Math.min(1, (rsiValue - rsiOverbought) / (100 - rsiOverbought) + 0.3),
        reason: `Close ${current.close.toFixed(2)} en/sobre banda superior de Bollinger (${upper.toFixed(2)}, media ${mid.toFixed(2)}) CON RSI(${rsiPeriod})=${rsiValue.toFixed(1)} en sobrecompra (>=${rsiOverbought}).`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { bandLevel: upper, bbMid: mid, rsi: rsiValue, stopDistance, rrr },
      };
    }
    return null;
  },
};
