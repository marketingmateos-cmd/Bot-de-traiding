import { atr, zScore } from "../../features";
import type { StrategyDefinition } from "../types";
import { ALL_REGIMES, BASELINE_COST_MODEL } from "../baseline/shared";

/**
 * Fase 17 — Family B: Volume / Participation Confirmation. Hypothesis and
 * parameter justification live in `./hypothesisRegistry.ts`. A short-term
 * price return only fires when accompanied by abnormal participation (a
 * volume z-score above threshold) — a move without that confirmation is
 * left alone entirely, never traded "anyway". Both the price return and the
 * volume z-score use only the CURRENT bar's own close/volume plus strictly
 * past bars — the same instant its own close already becomes usable.
 */
export const volumeConfirmationStrategy: StrategyDefinition = {
  id: "research-volume-confirmation-v1",
  kind: "VOLUME_CONFIRMATION",
  name: "Volume Participation Confirmation (Fase 17)",
  version: "1.0",
  defaultParams: { priceLookback: 5, priceThreshold: 0.01, volumeZPeriod: 20, volumeZThreshold: 1.5, volatilityPeriod: 14, rrr: 1.5 },
  timeframe: "H1",
  recommendedRegimes: ALL_REGIMES,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 3,
  defaultTrailingStopPct: null,
  costModel: BASELINE_COST_MODEL,
  evaluate(bars, features, params) {
    const priceLookback = Number(params.priceLookback ?? 5);
    const priceThreshold = Number(params.priceThreshold ?? 0.01);
    const volumeZPeriod = Number(params.volumeZPeriod ?? 20);
    const volumeZThreshold = Number(params.volumeZThreshold ?? 1.5);
    const volatilityPeriod = Number(params.volatilityPeriod ?? 14);
    const rrr = Number(params.rrr ?? 1.5);

    if (bars.length < Math.max(priceLookback, volumeZPeriod) + 1) return null;

    const current = bars[bars.length - 1];
    const pastBar = bars[bars.length - 1 - priceLookback]; // strictly a PAST bar
    if (pastBar.close <= 0) return null;
    const priceReturn = (current.close - pastBar.close) / pastBar.close;

    const volumes = bars.map((b) => b.volume);
    const volZArr = zScore(volumes, volumeZPeriod);
    const volumeZ = volZArr[volZArr.length - 1];
    if (volumeZ === null) return null;
    if (volumeZ <= volumeZThreshold) return null; // no abnormal participation — nothing to confirm, no trade

    const atrArr = atr(bars, volatilityPeriod);
    const atrValue = atrArr[atrArr.length - 1];
    if (atrValue === null || atrValue <= 0) return null;
    const stopDistance = atrValue;

    if (priceReturn > priceThreshold) {
      return {
        kind: "VOLUME_CONFIRMATION",
        direction: "LONG",
        strength: Math.min(1, priceReturn / (priceThreshold * 3)),
        reason: `Retorno de ${(priceReturn * 100).toFixed(2)}% en ${priceLookback} velas confirmado por volumen anómalo (z=${volumeZ.toFixed(2)} > ${volumeZThreshold}).`,
        stopLossPrice: current.close - stopDistance,
        takeProfitPrice: current.close + stopDistance * rrr,
        meta: { priceReturnPct: priceReturn * 100, volumeZ, stopDistance, rrr },
      };
    }
    if (priceReturn < -priceThreshold) {
      return {
        kind: "VOLUME_CONFIRMATION",
        direction: "SHORT",
        strength: Math.min(1, Math.abs(priceReturn) / (priceThreshold * 3)),
        reason: `Retorno de ${(priceReturn * 100).toFixed(2)}% en ${priceLookback} velas confirmado por volumen anómalo (z=${volumeZ.toFixed(2)} > ${volumeZThreshold}).`,
        stopLossPrice: current.close + stopDistance,
        takeProfitPrice: current.close - stopDistance * rrr,
        meta: { priceReturnPct: priceReturn * 100, volumeZ, stopDistance, rrr },
      };
    }
    return null;
  },
};
