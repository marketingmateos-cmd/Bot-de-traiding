export type RiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "CUSTOM";

export const RISK_PROFILE_DEFAULTS: Record<Exclude<RiskProfile, "CUSTOM">, {
  riskPerTradePct: number; // % of equity risked per trade (to stop loss)
  maxExposurePct: number; // % of equity allowed in open positions at once
  maxOpenPositions: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxConcentrationPct: number; // % of equity allowed in a SINGLE asset, across all strategies/positions combined
}> = {
  CONSERVATIVE: { riskPerTradePct: 0.5, maxExposurePct: 30, maxOpenPositions: 2, maxDailyLossPct: 2, maxDrawdownPct: 10, maxConcentrationPct: 15 },
  BALANCED: { riskPerTradePct: 1, maxExposurePct: 50, maxOpenPositions: 4, maxDailyLossPct: 4, maxDrawdownPct: 18, maxConcentrationPct: 25 },
  AGGRESSIVE: { riskPerTradePct: 2, maxExposurePct: 75, maxOpenPositions: 6, maxDailyLossPct: 8, maxDrawdownPct: 30, maxConcentrationPct: 35 },
};

export interface RiskLimits {
  riskPerTradePct: number;
  maxExposurePct: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxConcentrationPct: number;
}

export function resolveRiskLimits(profile: RiskProfile, custom?: Partial<RiskLimits>): RiskLimits {
  if (profile === "CUSTOM") {
    return {
      riskPerTradePct: custom?.riskPerTradePct ?? 1,
      maxExposurePct: custom?.maxExposurePct ?? 50,
      maxOpenPositions: custom?.maxOpenPositions ?? 4,
      maxDailyLossPct: custom?.maxDailyLossPct ?? 4,
      maxDrawdownPct: custom?.maxDrawdownPct ?? 18,
      maxConcentrationPct: custom?.maxConcentrationPct ?? 25,
    };
  }
  return RISK_PROFILE_DEFAULTS[profile];
}

// The real 1-10 dial (spec: "Bot Risk" slider). Anchored at four points —
// 1 and 3 bracket Conservative, 4 and 6 bracket Balanced, 7 and 8 bracket
// Aggressive, 9 and 10 extrapolate to Very Aggressive — and linearly
// interpolated between them, so every one of the 10 levels produces a
// genuinely distinct set of limits rather than just relabeling 4 buckets.
const RISK_LEVEL_ANCHORS: [level: number, limits: RiskLimits][] = [
  [1, { riskPerTradePct: 0.3, maxExposurePct: 20, maxOpenPositions: 1, maxDailyLossPct: 1.5, maxDrawdownPct: 8, maxConcentrationPct: 10 }],
  [3, RISK_PROFILE_DEFAULTS.CONSERVATIVE],
  [6, RISK_PROFILE_DEFAULTS.BALANCED],
  [8, RISK_PROFILE_DEFAULTS.AGGRESSIVE],
  [10, { riskPerTradePct: 3, maxExposurePct: 90, maxOpenPositions: 8, maxDailyLossPct: 12, maxDrawdownPct: 40, maxConcentrationPct: 45 }],
];

export type RiskPreset = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "VERY_AGGRESSIVE";

export function riskPresetForLevel(level: number): RiskPreset {
  if (level <= 3) return "CONSERVATIVE";
  if (level <= 6) return "BALANCED";
  if (level <= 8) return "AGGRESSIVE";
  return "VERY_AGGRESSIVE";
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Real, quantitative effect of the 1-10 risk slider — see spec section 12. */
export function resolveRiskLimitsForLevel(levelInput: number): RiskLimits {
  const level = Math.max(1, Math.min(10, levelInput));
  let lower = RISK_LEVEL_ANCHORS[0];
  let upper = RISK_LEVEL_ANCHORS[RISK_LEVEL_ANCHORS.length - 1];
  for (let i = 0; i < RISK_LEVEL_ANCHORS.length - 1; i++) {
    if (level >= RISK_LEVEL_ANCHORS[i][0] && level <= RISK_LEVEL_ANCHORS[i + 1][0]) {
      lower = RISK_LEVEL_ANCHORS[i];
      upper = RISK_LEVEL_ANCHORS[i + 1];
      break;
    }
  }
  const [lowLevel, lowLimits] = lower;
  const [highLevel, highLimits] = upper;
  const t = highLevel === lowLevel ? 0 : (level - lowLevel) / (highLevel - lowLevel);

  return {
    riskPerTradePct: Math.round(lerp(lowLimits.riskPerTradePct, highLimits.riskPerTradePct, t) * 100) / 100,
    maxExposurePct: Math.round(lerp(lowLimits.maxExposurePct, highLimits.maxExposurePct, t)),
    maxOpenPositions: Math.round(lerp(lowLimits.maxOpenPositions, highLimits.maxOpenPositions, t)),
    maxDailyLossPct: Math.round(lerp(lowLimits.maxDailyLossPct, highLimits.maxDailyLossPct, t) * 10) / 10,
    maxDrawdownPct: Math.round(lerp(lowLimits.maxDrawdownPct, highLimits.maxDrawdownPct, t)),
    maxConcentrationPct: Math.round(lerp(lowLimits.maxConcentrationPct, highLimits.maxConcentrationPct, t)),
  };
}

export interface PositionSizeInput {
  equity: number;
  entryPrice: number;
  stopLossPrice: number;
  riskPerTradePct: number;
}

export interface PositionSizeResult {
  quantity: number;
  notional: number;
  riskAmount: number;
  riskPct: number;
}

/** Classic fixed-fractional position sizing: risk a fixed % of equity to the stop. */
export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const { equity, entryPrice, stopLossPrice, riskPerTradePct } = input;
  const riskAmount = equity * (riskPerTradePct / 100);
  const perUnitRisk = Math.abs(entryPrice - stopLossPrice);
  if (perUnitRisk <= 0) {
    return { quantity: 0, notional: 0, riskAmount: 0, riskPct: 0 };
  }
  const quantity = riskAmount / perUnitRisk;
  const notional = quantity * entryPrice;
  return { quantity, notional, riskAmount, riskPct: riskPerTradePct };
}

export interface ExposureCheckInput {
  equity: number;
  openNotional: number; // sum of existing open position notionals (all assets, all strategies)
  newNotional: number;
  limits: RiskLimits;
  openPositionCount: number;
  /**
   * Sum of existing open position notionals for the SAME asset this
   * candidate would trade, across every strategy version — not just the
   * one asking to open now. Without this, the aggregate exposure check
   * alone can't stop several different strategies from independently
   * piling into one asset (Fase 1.A4 fix): each stays under the total
   * exposure cap while their combined bet on that one asset does not.
   */
  assetOpenNotional: number;
}

export type RiskViolationKind = "EXPOSURE" | "POSITION_SIZE" | "CONCENTRATION";

export interface RiskCheckResult {
  passed: boolean;
  violations: string[];
  /** Machine-readable tag per violation, same order as `violations` — feeds RiskEvent.kind (Fase 2). */
  violationKinds: RiskViolationKind[];
  exposurePctAfter: number;
}

export function checkExposureLimits(input: ExposureCheckInput): RiskCheckResult {
  const violations: string[] = [];
  const violationKinds: RiskViolationKind[] = [];
  const totalNotional = input.openNotional + input.newNotional;
  const exposurePctAfter = input.equity > 0 ? (totalNotional / input.equity) * 100 : 100;

  if (exposurePctAfter > input.limits.maxExposurePct) {
    violations.push(`La exposición proyectada del ${exposurePctAfter.toFixed(1)}% supera el máximo de ${input.limits.maxExposurePct}%.`);
    violationKinds.push("EXPOSURE");
  }
  if (input.openPositionCount + 1 > input.limits.maxOpenPositions) {
    violations.push(`Abrir esta posición superaría el máximo de posiciones abiertas (${input.limits.maxOpenPositions}).`);
    violationKinds.push("POSITION_SIZE");
  }

  const assetTotalNotional = input.assetOpenNotional + input.newNotional;
  const assetConcentrationPctAfter = input.equity > 0 ? (assetTotalNotional / input.equity) * 100 : 100;
  if (assetConcentrationPctAfter > input.limits.maxConcentrationPct) {
    violations.push(
      `La concentración proyectada en este activo (${assetConcentrationPctAfter.toFixed(1)}%, sumando todas las estrategias) supera el máximo de ${input.limits.maxConcentrationPct}% por activo.`
    );
    violationKinds.push("CONCENTRATION");
  }

  return { passed: violations.length === 0, violations, violationKinds, exposurePctAfter };
}

export function computeDrawdown(equityCurve: number[]): { current: number; max: number } {
  let peak = -Infinity;
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  for (const equity of equityCurve) {
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);
    currentDrawdown = dd;
  }
  return { current: currentDrawdown, max: maxDrawdown };
}

/** Pearson correlation between two equal-length return series, for portfolio correlation risk. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const aSlice = a.slice(-n);
  const bSlice = b.slice(-n);
  const meanA = aSlice.reduce((s, v) => s + v, 0) / n;
  const meanB = bSlice.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = aSlice[i] - meanA;
    const db = bSlice[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}
