import { atr } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia D v2 — Apex Breakout + Circuit Breaker Anti-Racha (evolución
 * de `momentumBreakoutFtmo.ts` v1, registrada por separado — v1 NUNCA se
 * sobrescribe ni se modifica, sigue disponible para comparar).
 *
 * Mantiene INTACTO el núcleo de v1 (compresión previa + gatillo de alta
 * energía + ruptura real del rango, objetivo asimétrico R:R) y añade UN
 * mecanismo de control de riesgo: un Circuit Breaker Anti-Racha (Consecutive
 * Loss Circuit Breaker) — tras `circuitBreakerThreshold` (3 por defecto)
 * pérdidas CONSECUTIVAS de esta misma estrategia, el tamaño de las
 * siguientes operaciones se reduce a `circuitBreakerScaleFactor` (50% por
 * defecto) del tamaño normal, hasta que una operación ganadora reinicia el
 * contador.
 *
 * Motivo, a partir de la evidencia REAL de v1 (backtest sobre BTC/ETH H1,
 * mismas 2 ventanas de 12 meses ya usadas para A/B/C): v1 fue la primera
 * candidata con expectancy media positiva (+0.14/operación, 3 de 4 ventanas
 * ganadoras) pero violó el límite de Max Drawdown de FTMO (<10%) en las 2
 * ventanas bajistas (13.75% y 12.84%) — precisamente las que más rentabilidad
 * generaron. Un sistema de R:R asimétrico (objetivo 3.5x el riesgo, win rate
 * ~29%) acumula, por diseño, rachas de varias pérdidas pequeñas antes del
 * acierto grande que las compensa; el drawdown se dispara cuando esas rachas
 * se alargan más de lo habitual en regímenes volátiles/bajistas. Reducir el
 * riesgo por operación DURANTE una racha ya en curso (en vez de cambiar la
 * lógica de entrada, que es la fuente del edge) ataca directamente esa causa
 * sin tocar la asimetría que hace rentable a la estrategia.
 *
 * IMPORTANTE — por qué esto necesita soporte del motor: `evaluate()` es una
 * función PURA de bars/features/params/régimen — no tiene, por diseño,
 * acceso al historial de operaciones propio (así es para las 8 estrategias
 * candidatas anteriores). El número de pérdidas consecutivas SOLO puede
 * conocerlo el motor que ejecuta las operaciones reales
 * (`backtest.ts`/`historicalReplayEngine.ts`), que ahora lo calcula a partir
 * de sus propios trades cerrados y lo pasa en `context.consecutiveLosses`.
 * La estrategia, a su vez, comunica el factor de reducción de vuelta al
 * motor en `signal.riskScaleFactor` — ambos son campos OPCIONALES en los
 * tipos compartidos (`StrategyContext`/`StrategySignal`); las 8 estrategias
 * candidatas anteriores (y las 7 originales) simplemente no los usan y
 * quedan completamente inafectadas.
 */
export const momentumBreakoutFtmoV2Strategy: StrategyDefinition = {
  id: "momentum-breakout-ftmo-v2",
  kind: "BREAKOUT",
  name: "Apex Breakout FTMO v2 (Candidata D — Circuit Breaker Anti-Racha)",
  version: "2.0",
  defaultParams: {
    volatilityPeriod: 14,
    compressionLookback: 10,
    baselinePeriod: 50,
    compressionThreshold: 0.65,
    bodyAtrMultiplier: 1.5,
    atrMultiplier: 1,
    rrr: 3.5,
    circuitBreakerThreshold: 3,
    circuitBreakerScaleFactor: 0.5,
  },
  timeframe: "H1",
  // Idéntico a v1: una compresión de volatilidad puede empezar en
  // RANGE/LOW_VOLATILITY y resolverse hacia TRANSITION/HIGH_VOLATILITY en
  // la propia vela de activación.
  recommendedRegimes: ["RANGE", "LOW_VOLATILITY", "TRANSITION", "HIGH_VOLATILITY"],
  defaultStopLossPct: 1.2,
  defaultTakeProfitPct: 4.2,
  defaultTrailingStopPct: null,
  costModel: FTMO_COST_MODEL,
  evaluate(bars, features, params, regime, context) {
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const compressionLookback = Number(params.compressionLookback ?? 10);
    const baselinePeriod = Number(params.baselinePeriod ?? 50);
    const compressionThreshold = Number(params.compressionThreshold ?? 0.65);
    const bodyAtrMultiplier = Number(params.bodyAtrMultiplier ?? 1.5);
    const atrMultiplier = Number(params.atrMultiplier ?? 1);
    const rrr = Number(params.rrr ?? 3.5);
    const circuitBreakerThreshold = Number(params.circuitBreakerThreshold ?? 3);
    const circuitBreakerScaleFactor = Number(params.circuitBreakerScaleFactor ?? 0.5);

    const minBars = Math.max(volatilityPeriod, baselinePeriod) + compressionLookback + 2;
    if (bars.length < minBars) return null;

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;

    const current = bars[bars.length - 1];
    const body = Math.abs(current.close - current.open);

    // 1) Gatillo de alta energía — idéntico a v1, sin cambios.
    if (body < atrValue * bodyAtrMultiplier) return null;

    // 2) Compresión previa — idéntico a v1, sin cambios.
    const recentWindow = atrArr.slice(-compressionLookback - 1, -1).filter((v): v is number => v !== null);
    if (recentWindow.length < compressionLookback) return null;
    const recentAvgAtr = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length;

    const baselineWindow = atrArr.slice(-baselinePeriod - 1, -1).filter((v): v is number => v !== null);
    if (baselineWindow.length < baselinePeriod) return null;
    const baselineAvgAtr = baselineWindow.reduce((a, b) => a + b, 0) / baselineWindow.length;
    if (baselineAvgAtr <= 0) return null;

    const compressionRatio = recentAvgAtr / baselineAvgAtr;
    if (compressionRatio > compressionThreshold) return null;

    // 3) Ruptura real del rango comprimido — idéntico a v1, sin cambios.
    const compressionBars = bars.slice(-compressionLookback - 1, -1);
    const rangeHigh = Math.max(...compressionBars.map((b) => b.high));
    const rangeLow = Math.min(...compressionBars.map((b) => b.low));

    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    // Circuit Breaker Anti-Racha: si esta misma estrategia lleva
    // `circuitBreakerThreshold` o más pérdidas seguidas (dato que el motor
    // de simulación calcula de sus propios trades cerrados, nunca inferido
    // aquí), el tamaño de esta entrada se reduce a `circuitBreakerScaleFactor`
    // — nunca se cancela la entrada por completo: el edge sigue viniendo de
    // la misma lógica de compresión+energía+ruptura, solo se arriesga menos
    // capital mientras la racha continúa.
    const consecutiveLosses = context?.consecutiveLosses ?? 0;
    const riskScaleFactor = consecutiveLosses >= circuitBreakerThreshold ? circuitBreakerScaleFactor : 1;
    const circuitBreakerActive = riskScaleFactor < 1;

    if (current.close > rangeHigh && current.close > current.open) {
      return {
        kind: "BREAKOUT",
        direction: "LONG",
        strength: Math.min(1, (body / (atrValue * bodyAtrMultiplier) - 1) * 0.5 + (1 - compressionRatio / compressionThreshold) * 0.5),
        reason: `Ruptura de alta energía: cuerpo ${body.toFixed(2)} >= ${bodyAtrMultiplier}×ATR(${volatilityPeriod}) tras compresión (ATR reciente/base=${compressionRatio.toFixed(2)} <= ${compressionThreshold}), close ${current.close.toFixed(2)} > máximo comprimido ${rangeHigh.toFixed(2)}; objetivo asimétrico RRR=${rrr}.${circuitBreakerActive ? ` Circuit breaker ACTIVO (${consecutiveLosses} pérdidas seguidas) — tamaño reducido a ${(circuitBreakerScaleFactor * 100).toFixed(0)}%.` : ""}`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { rangeLevel: rangeHigh, compressionRatio, body, stopDistance, rrr, consecutiveLosses, riskScaleFactor },
        riskScaleFactor,
      };
    }
    if (current.close < rangeLow && current.close < current.open) {
      return {
        kind: "BREAKOUT",
        direction: "SHORT",
        strength: Math.min(1, (body / (atrValue * bodyAtrMultiplier) - 1) * 0.5 + (1 - compressionRatio / compressionThreshold) * 0.5),
        reason: `Ruptura de alta energía: cuerpo ${body.toFixed(2)} >= ${bodyAtrMultiplier}×ATR(${volatilityPeriod}) tras compresión (ATR reciente/base=${compressionRatio.toFixed(2)} <= ${compressionThreshold}), close ${current.close.toFixed(2)} < mínimo comprimido ${rangeLow.toFixed(2)}; objetivo asimétrico RRR=${rrr}.${circuitBreakerActive ? ` Circuit breaker ACTIVO (${consecutiveLosses} pérdidas seguidas) — tamaño reducido a ${(circuitBreakerScaleFactor * 100).toFixed(0)}%.` : ""}`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { rangeLevel: rangeLow, compressionRatio, body, stopDistance, rrr, consecutiveLosses, riskScaleFactor },
        riskScaleFactor,
      };
    }
    return null;
  },
};
