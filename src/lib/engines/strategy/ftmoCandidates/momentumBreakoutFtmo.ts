import { atr, sma } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia D — Apex Breakout (candidata FTMO). Estilo ruptura de
 * volatilidad institucional (Larry Williams / "coiled spring"): un mercado
 * que se COMPRIME (volatilidad reciente muy por debajo de su propia media
 * de referencia) tiende a resolver esa compresión con un movimiento
 * expansivo — pero solo cuando ese movimiento llega con ENERGÍA real
 * (una vela cuyo cuerpo excede claramente el ATR normal), nunca con una
 * ruptura débil que podría revertir en la siguiente vela. Estructuralmente
 * distinta de `trendBreakoutFtmo.ts` (que exige alineación con una
 * tendencia ya establecida) y de `volatility.ts` original (que solo mide
 * expansión de ATR, sin exigir una fase de compresión previa ni un cuerpo
 * de vela mínimo): aquí las TRES condiciones — compresión previa, cuerpo
 * de alta energía, ruptura del rango comprimido — deben cumplirse a la
 * vez. El objetivo es asimétrico (R:R 1:3–1:4 por defecto) porque la
 * premisa es que muy pocas rupturas de este tipo ocurren, pero las que
 * cumplen las tres condiciones a la vez tienden a recorrer varias veces
 * su propio riesgo inicial — arriesgar poco, dejar correr lo suficiente
 * para cubrir varias pérdidas pequeñas con un solo acierto grande.
 *
 * Filtro de régimen macro global (añadido en el mismo v1 — edición directa,
 * no una nueva variante): el gate táctico `recommendedRegimes` ya excluye
 * BEAR/STRONG_BEAR, pero ese gate se mide sobre una ventana LOCAL (~60
 * velas) — dentro de una tendencia estructural bajista más amplia siguen
 * ocurriendo tramos locales de RANGE/TRANSITION/HIGH_VOLATILITY que ese gate
 * sí deja pasar, y fue precisamente ahí donde el Max Drawdown superó el
 * límite de FTMO. El filtro macro añade un segundo juicio, de horizonte
 * mucho más largo (`macroPeriod` velas): si el precio cotiza claramente por
 * debajo de esa media de largo plazo Y la media misma lleva
 * `macroSlopeLookback` velas descendiendo, el fondo se considera una
 * tendencia bajista clara/sucia y la estrategia no genera ninguna señal —
 * en ninguna dirección — hasta que el fondo deje de serlo.
 */
export const momentumBreakoutFtmoStrategy: StrategyDefinition = {
  id: "momentum-breakout-ftmo-v1",
  kind: "BREAKOUT",
  name: "Apex Breakout FTMO (Candidata D)",
  version: "1.0",
  defaultParams: {
    volatilityPeriod: 14,
    compressionLookback: 10,
    baselinePeriod: 50,
    compressionThreshold: 0.65,
    bodyAtrMultiplier: 1.5,
    atrMultiplier: 1,
    rrr: 3.5,
    macroPeriod: 100,
    macroSlopeLookback: 20,
    macroDeviationThreshold: 0.02,
    macroSlopeThreshold: 0.005,
  },
  timeframe: "H1",
  // Una compresión de volatilidad puede empezar en RANGE/LOW_VOLATILITY y
  // resolverse hacia TRANSITION/HIGH_VOLATILITY en la propia vela de
  // activación (el régimen se mide EN esa vela, ya con la expansión
  // reflejada) — se permiten las cuatro, nunca las de tendencia ya
  // establecida (ese es el terreno de la Candidata A, no de esta).
  recommendedRegimes: ["RANGE", "LOW_VOLATILITY", "TRANSITION", "HIGH_VOLATILITY"],
  defaultStopLossPct: 1.2,
  defaultTakeProfitPct: 4.2,
  defaultTrailingStopPct: null,
  costModel: FTMO_COST_MODEL,
  evaluate(bars, features, params) {
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const compressionLookback = Number(params.compressionLookback ?? 10);
    const baselinePeriod = Number(params.baselinePeriod ?? 50);
    const compressionThreshold = Number(params.compressionThreshold ?? 0.65);
    const bodyAtrMultiplier = Number(params.bodyAtrMultiplier ?? 1.5);
    const atrMultiplier = Number(params.atrMultiplier ?? 1);
    const rrr = Number(params.rrr ?? 3.5);
    const macroPeriod = Number(params.macroPeriod ?? 100);
    const macroSlopeLookback = Number(params.macroSlopeLookback ?? 20);
    const macroDeviationThreshold = Number(params.macroDeviationThreshold ?? 0.02);
    const macroSlopeThreshold = Number(params.macroSlopeThreshold ?? 0.005);

    const minBars = Math.max(volatilityPeriod, baselinePeriod, macroPeriod + macroSlopeLookback) + compressionLookback + 2;
    if (bars.length < minBars) return null;

    const current = bars[bars.length - 1];

    // 0) Filtro de régimen macro global: media de largo plazo `macroPeriod`
    // (incluye la vela actual — es un indicador en vivo de dónde cotiza el
    // precio AHORA respecto al fondo estructural, no una ventana "prior");
    // la pendiente se juzga comparando ese valor con el mismo indicador
    // `macroSlopeLookback` velas atrás (estrictamente pasado). Si el precio
    // está claramente por debajo de la media Y la media misma desciende, el
    // fondo es bajista claro/sucio: cero entradas, en cualquier dirección.
    const closes = bars.map((b) => b.close);
    const smaLongArr = sma(closes, macroPeriod);
    const smaLongNow = smaLongArr[smaLongArr.length - 1];
    const smaLongPast = smaLongArr[smaLongArr.length - 1 - macroSlopeLookback];
    if (smaLongNow === null || smaLongPast === null || smaLongNow <= 0 || smaLongPast <= 0) return null;

    const macroDeviationPct = (current.close - smaLongNow) / smaLongNow;
    const macroSlopePct = (smaLongNow - smaLongPast) / smaLongPast;
    const dirtyBearishMacro = macroDeviationPct <= -macroDeviationThreshold && macroSlopePct <= -macroSlopeThreshold;
    if (dirtyBearishMacro) return null; // fondo macro bajista claro/sucio — estrategia desactivada por completo

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;

    const body = Math.abs(current.close - current.open);

    // 1) Gatillo de alta energía: el cuerpo de la vela actual debe superar
    // claramente el ATR normal — una ruptura débil (cuerpo pequeño aunque
    // el precio toque un nuevo extremo) se descarta, nunca se relaja.
    if (body < atrValue * bodyAtrMultiplier) return null;

    // 2) Compresión previa: la ventana de `compressionLookback` velas
    // ESTRICTAMENTE anteriores (nunca la vela actual) debe tener un ATR
    // medio muy por debajo de la media de referencia de `baselinePeriod`
    // velas, también estrictamente anteriores — el mercado se ha "enroscado"
    // antes de esta vela. Umbral RELATIVO (ratio), no un valor absoluto,
    // para generalizar entre activos de escala distinta.
    const recentWindow = atrArr.slice(-compressionLookback - 1, -1).filter((v): v is number => v !== null);
    if (recentWindow.length < compressionLookback) return null;
    const recentAvgAtr = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length;

    const baselineWindow = atrArr.slice(-baselinePeriod - 1, -1).filter((v): v is number => v !== null);
    if (baselineWindow.length < baselinePeriod) return null;
    const baselineAvgAtr = baselineWindow.reduce((a, b) => a + b, 0) / baselineWindow.length;
    if (baselineAvgAtr <= 0) return null;

    const compressionRatio = recentAvgAtr / baselineAvgAtr;
    if (compressionRatio > compressionThreshold) return null; // el mercado no estaba comprimido — se descarta

    // 3) Ruptura real del rango comprimido: el cierre actual debe superar
    // el máximo/mínimo de esas mismas `compressionLookback` velas
    // anteriores (la ventana EXCLUYE la vela actual, igual que el resto
    // del repositorio) — nunca comparar la vela contra su propio high/low.
    const compressionBars = bars.slice(-compressionLookback - 1, -1);
    const rangeHigh = Math.max(...compressionBars.map((b) => b.high));
    const rangeLow = Math.min(...compressionBars.map((b) => b.low));

    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    if (current.close > rangeHigh && current.close > current.open) {
      return {
        kind: "BREAKOUT",
        direction: "LONG",
        strength: Math.min(1, (body / (atrValue * bodyAtrMultiplier) - 1) * 0.5 + (1 - compressionRatio / compressionThreshold) * 0.5),
        reason: `Ruptura de alta energía: cuerpo ${body.toFixed(2)} >= ${bodyAtrMultiplier}×ATR(${volatilityPeriod}) tras compresión (ATR reciente/base=${compressionRatio.toFixed(2)} <= ${compressionThreshold}), close ${current.close.toFixed(2)} > máximo comprimido ${rangeHigh.toFixed(2)}; objetivo asimétrico RRR=${rrr}.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { rangeLevel: rangeHigh, compressionRatio, body, stopDistance, rrr, macroDeviationPct, macroSlopePct },
      };
    }
    if (current.close < rangeLow && current.close < current.open) {
      return {
        kind: "BREAKOUT",
        direction: "SHORT",
        strength: Math.min(1, (body / (atrValue * bodyAtrMultiplier) - 1) * 0.5 + (1 - compressionRatio / compressionThreshold) * 0.5),
        reason: `Ruptura de alta energía: cuerpo ${body.toFixed(2)} >= ${bodyAtrMultiplier}×ATR(${volatilityPeriod}) tras compresión (ATR reciente/base=${compressionRatio.toFixed(2)} <= ${compressionThreshold}), close ${current.close.toFixed(2)} < mínimo comprimido ${rangeLow.toFixed(2)}; objetivo asimétrico RRR=${rrr}.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { rangeLevel: rangeLow, compressionRatio, body, stopDistance, rrr, macroDeviationPct, macroSlopePct },
      };
    }
    // Compresión + energía sin ruptura real del rango (o dirección del
    // cuerpo inconsistente con la ruptura) se descarta — nunca se relaja
    // ninguna de las tres condiciones a la vez.
    return null;
  },
};
