import { atr } from "../../features";
import type { StrategyDefinition } from "../types";
import { FTMO_COST_MODEL } from "./shared";

/**
 * Estrategia E — Sniper High Conviction (candidata FTMO). Evolución
 * deliberadamente MÁS restrictiva de `momentumBreakoutFtmo.ts` (Candidata
 * D): en vez de tres condiciones simultáneas, exige CUATRO — compresión
 * MÁXIMA (umbral 0.5, frente al 0.65 de D), un gatillo de energía masivo
 * (cuerpo >= 2.0×ATR, frente a 1.5×ATR de D), un pico de VOLUMEN real (el
 * volumen negociado de la vela actual debe ser >= 2.0× su propia media
 * reciente — una confirmación estructuralmente nueva, que ninguna otra
 * candidata FTMO usa) y una ruptura real del rango comprimido. La premisa
 * es "pocas operaciones, apostadas fuerte": cuando las cuatro condiciones
 * coinciden a la vez, la convicción es la máxima posible dentro de este
 * conjunto de candidatas, así que el tamaño de la operación se escala
 * AGRESIVAMENTE hacia arriba (`riskScaleFactor` > 1, reutilizando el mismo
 * mecanismo de escalado de riesgo introducido en la Candidata D v2, pero
 * aquí para aumentar el riesgo en vez de reducirlo) en vez de mantenerse
 * en el 1% estándar del resto de candidatas. Objetivo R:R 1:4, el más
 * amplio de toda la familia FTMO.
 */
export const sniperHighConvictionFtmoStrategy: StrategyDefinition = {
  id: "sniper-high-conviction-ftmo-v1",
  kind: "BREAKOUT",
  name: "Sniper High Conviction FTMO (Candidata E)",
  version: "1.0",
  defaultParams: {
    volatilityPeriod: 14,
    compressionLookback: 10,
    baselinePeriod: 50,
    compressionThreshold: 0.5,
    bodyAtrMultiplier: 2,
    volumeLookback: 20,
    volumeMultiplier: 2,
    atrMultiplier: 1,
    rrr: 4,
    riskScaleFactor: 2,
  },
  timeframe: "H1",
  // Idéntico a la Candidata D: una compresión de volatilidad puede empezar
  // en RANGE/LOW_VOLATILITY y resolverse hacia TRANSITION/HIGH_VOLATILITY
  // en la propia vela de activación.
  recommendedRegimes: ["RANGE", "LOW_VOLATILITY", "TRANSITION", "HIGH_VOLATILITY"],
  defaultStopLossPct: 1.2,
  defaultTakeProfitPct: 4.8,
  defaultTrailingStopPct: null,
  costModel: FTMO_COST_MODEL,
  evaluate(bars, features, params) {
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const compressionLookback = Number(params.compressionLookback ?? 10);
    const baselinePeriod = Number(params.baselinePeriod ?? 50);
    const compressionThreshold = Number(params.compressionThreshold ?? 0.5);
    const bodyAtrMultiplier = Number(params.bodyAtrMultiplier ?? 2);
    const volumeLookback = Number(params.volumeLookback ?? 20);
    const volumeMultiplier = Number(params.volumeMultiplier ?? 2);
    const atrMultiplier = Number(params.atrMultiplier ?? 1);
    const rrr = Number(params.rrr ?? 4);
    const riskScaleFactor = Number(params.riskScaleFactor ?? 2);

    const minBars = Math.max(volatilityPeriod, baselinePeriod, volumeLookback) + compressionLookback + 2;
    if (bars.length < minBars) return null;

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;

    const current = bars[bars.length - 1];
    const body = Math.abs(current.close - current.open);

    // 1) Gatillo de energía MASIVO: el cuerpo debe superar 2.0×ATR (más
    // estricto que el 1.5×ATR de la Candidata D) — una ruptura "grande" no
    // basta, tiene que ser excepcional.
    if (body < atrValue * bodyAtrMultiplier) return null;

    // 2) Gatillo de VOLUMEN real (nuevo frente a todas las candidatas
    // anteriores): el volumen negociado de la vela actual debe ser >=
    // volumeMultiplier veces la media de su propio volumen de las
    // `volumeLookback` velas ESTRICTAMENTE anteriores — una ruptura de
    // precio sin participación real (poco volumen) se descarta, por muy
    // grande que sea el cuerpo de la vela.
    const priorVolumeWindow = bars.slice(-volumeLookback - 1, -1).map((b) => b.volume);
    if (priorVolumeWindow.length < volumeLookback) return null;
    const avgVolume = priorVolumeWindow.reduce((a, b) => a + b, 0) / priorVolumeWindow.length;
    if (avgVolume <= 0) return null;
    const volumeRatio = current.volume / avgVolume;
    if (volumeRatio < volumeMultiplier) return null;

    // 3) Compresión MÁXIMA previa: umbral 0.5 (más estricto que el 0.65 de
    // la Candidata D) — la ventana EXCLUYE la vela actual.
    const recentWindow = atrArr.slice(-compressionLookback - 1, -1).filter((v): v is number => v !== null);
    if (recentWindow.length < compressionLookback) return null;
    const recentAvgAtr = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length;

    const baselineWindow = atrArr.slice(-baselinePeriod - 1, -1).filter((v): v is number => v !== null);
    if (baselineWindow.length < baselinePeriod) return null;
    const baselineAvgAtr = baselineWindow.reduce((a, b) => a + b, 0) / baselineWindow.length;
    if (baselineAvgAtr <= 0) return null;

    const compressionRatio = recentAvgAtr / baselineAvgAtr;
    if (compressionRatio > compressionThreshold) return null;

    // 4) Ruptura real del rango comprimido (ventana excluye la vela actual,
    // igual que el resto del repositorio).
    const compressionBars = bars.slice(-compressionLookback - 1, -1);
    const rangeHigh = Math.max(...compressionBars.map((b) => b.high));
    const rangeLow = Math.min(...compressionBars.map((b) => b.low));

    const stopDistance = atrValue * atrMultiplier;
    if (stopDistance <= 0) return null;

    if (current.close > rangeHigh && current.close > current.open) {
      return {
        kind: "BREAKOUT",
        direction: "LONG",
        // Señal de convicción máxima por construcción: las 4 condiciones
        // simultáneas ya son, en sí mismas, el filtro — no hay una
        // intensidad "más o menos fuerte" dentro de un disparo Sniper.
        strength: 1,
        reason: `SNIPER: ruptura de convicción máxima — cuerpo ${body.toFixed(2)} >= ${bodyAtrMultiplier}×ATR(${volatilityPeriod}), volumen ${current.volume.toFixed(0)} = ${volumeRatio.toFixed(2)}× su media (>= ${volumeMultiplier}×), compresión extrema (ratio ${compressionRatio.toFixed(2)} <= ${compressionThreshold}), close ${current.close.toFixed(2)} > máximo comprimido ${rangeHigh.toFixed(2)}; tamaño agresivo ${riskScaleFactor}×, objetivo RRR=${rrr}.`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { rangeLevel: rangeHigh, compressionRatio, volumeRatio, body, stopDistance, rrr, riskScaleFactor },
        riskScaleFactor,
      };
    }
    if (current.close < rangeLow && current.close < current.open) {
      return {
        kind: "BREAKOUT",
        direction: "SHORT",
        strength: 1,
        reason: `SNIPER: ruptura de convicción máxima — cuerpo ${body.toFixed(2)} >= ${bodyAtrMultiplier}×ATR(${volatilityPeriod}), volumen ${current.volume.toFixed(0)} = ${volumeRatio.toFixed(2)}× su media (>= ${volumeMultiplier}×), compresión extrema (ratio ${compressionRatio.toFixed(2)} <= ${compressionThreshold}), close ${current.close.toFixed(2)} < mínimo comprimido ${rangeLow.toFixed(2)}; tamaño agresivo ${riskScaleFactor}×, objetivo RRR=${rrr}.`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { rangeLevel: rangeLow, compressionRatio, volumeRatio, body, stopDistance, rrr, riskScaleFactor },
        riskScaleFactor,
      };
    }
    // Cualquiera de las cuatro condiciones sin las otras tres se descarta —
    // nunca se relaja ninguna a la vez, ni siquiera parcialmente.
    return null;
  },
};
