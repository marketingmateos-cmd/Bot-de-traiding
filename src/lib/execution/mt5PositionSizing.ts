import type { Mt5SymbolSpec } from "./types";

/**
 * MT5 Fase 2, spec section 4/10 — MT5-specific position sizing. Wraps the
 * SAME risk-per-trade philosophy as `riskEngine.ts`'s
 * `calculatePositionSize` (risk a fixed monetary amount to the stop) but
 * expressed in MT5 lots, constrained by the symbol's own broker-reported
 * metadata. Deliberately a SEPARATE function, not a rewrite of
 * `calculatePositionSize` — that function's crypto-style continuous
 * quantity is still exactly right for paper trading, which this never
 * touches.
 */
export interface Mt5PositionSizeInput {
  accountEquity: number;
  riskPct: number;
  entryPrice: number;
  stopLoss: number;
  symbolSpec: Mt5SymbolSpec;
  /** Optional — the Risk Engine's own exposure-clamped ceiling (checkExposureLimits().approvedNotional) for this candidate, if already computed. When given, volume is additionally capped so notional never exceeds it. */
  maxApprovedNotional?: number;
}

export type Mt5PositionSizeRejectionReason =
  | "INVALID_STOP_DISTANCE"
  | "INVALID_SYMBOL_METADATA"
  | "BELOW_MINIMUM_VOLUME"
  | "ZERO_OR_NEGATIVE_RISK_AMOUNT";

export type Mt5PositionSizeResult =
  | { approved: true; volume: number; riskAmount: number; notional: number }
  | { approved: false; reason: Mt5PositionSizeRejectionReason; detail: string };

/**
 * Never rounds UP past what the exact risk-based calculation supports —
 * volume is floored to `volumeStep`, so the resulting monetary risk is
 * always <= the requested risk amount, never above it. If flooring lands
 * below `volumeMin`, this REJECTS rather than rounding up to the minimum
 * (which would silently exceed the approved risk) — spec section 4: "Nunca
 * redondear el volumen de manera que aumente el riesgo por encima del
 * máximo aprobado" / "Si no se puede calcular el riesgo correctamente:
 * REJECT ORDER."
 */
export function calculateMt5PositionSize(input: Mt5PositionSizeInput): Mt5PositionSizeResult {
  const { accountEquity, riskPct, entryPrice, stopLoss, symbolSpec } = input;

  const riskAmount = accountEquity * (riskPct / 100);
  if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
    return { approved: false, reason: "ZERO_OR_NEGATIVE_RISK_AMOUNT", detail: `El monto de riesgo calculado (${riskAmount}) no es positivo.` };
  }

  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
    return { approved: false, reason: "INVALID_STOP_DISTANCE", detail: "La distancia entre entryPrice y stopLoss debe ser positiva." };
  }

  const { tickSize, tickValue, contractSize, volumeStep, volumeMin, volumeMax } = symbolSpec;
  if (!Number.isFinite(tickSize) || tickSize <= 0 || !Number.isFinite(tickValue) || tickValue <= 0 || !Number.isFinite(contractSize) || contractSize <= 0 || !Number.isFinite(volumeStep) || volumeStep <= 0) {
    return { approved: false, reason: "INVALID_SYMBOL_METADATA", detail: "tickSize, tickValue, contractSize y volumeStep deben ser positivos y finitos — el símbolo no tiene metadata utilizable." };
  }

  // Monetary risk for exactly 1.0 lot at this stop distance.
  const riskPerLot = (stopDistance / tickSize) * tickValue;
  if (!Number.isFinite(riskPerLot) || riskPerLot <= 0) {
    return { approved: false, reason: "INVALID_SYMBOL_METADATA", detail: "No se pudo derivar un riesgo por lote positivo a partir de la metadata del símbolo." };
  }

  const idealVolume = riskAmount / riskPerLot;
  // A tiny epsilon guards against floating-point noise (e.g. entryPrice -
  // stopLoss landing on 0.050000000000000044 instead of the exact decimal
  // 0.05) silently pushing an ideal volume that is mathematically EXACTLY
  // on a volumeStep boundary just below it, dropping a whole extra step for
  // no real reason. 1e-9 is many orders of magnitude smaller than any real
  // volumeStep, so this never lets the floor round UP past what the exact
  // calculation actually supports — it only cancels binary-floating-point
  // representation error.
  let flooredVolume = Math.floor(idealVolume / volumeStep + 1e-9) * volumeStep;

  // Additional, independent ceiling from the Risk Engine's own exposure
  // clamp, if supplied — never widens the volume, only ever narrows it further.
  if (input.maxApprovedNotional !== undefined) {
    const notionalPerLot = contractSize * entryPrice;
    if (notionalPerLot > 0) {
      const maxVolumeFromNotional = Math.floor(input.maxApprovedNotional / notionalPerLot / volumeStep + 1e-9) * volumeStep;
      flooredVolume = Math.min(flooredVolume, maxVolumeFromNotional);
    }
  }

  if (flooredVolume > volumeMax) flooredVolume = Math.floor(volumeMax / volumeStep + 1e-9) * volumeStep; // reduces risk further — always safe

  if (flooredVolume < volumeMin || flooredVolume <= 0) {
    return {
      approved: false,
      reason: "BELOW_MINIMUM_VOLUME",
      detail: `El volumen calculado (${flooredVolume}) es menor que el volumeMin del símbolo (${volumeMin}) — abrir al mínimo excedería el riesgo aprobado, así que se rechaza en vez de forzarlo.`,
    };
  }

  const actualRiskAmount = flooredVolume * riskPerLot;
  const notional = flooredVolume * contractSize * entryPrice;
  return { approved: true, volume: flooredVolume, riskAmount: actualRiskAmount, notional };
}
