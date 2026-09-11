export type RiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "CUSTOM";

export const RISK_PROFILE_DEFAULTS: Record<Exclude<RiskProfile, "CUSTOM">, {
  riskPerTradePct: number; // % of equity risked per trade (to stop loss)
  maxExposurePct: number; // % of equity allowed in open positions at once
  maxOpenPositions: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
}> = {
  CONSERVATIVE: { riskPerTradePct: 0.5, maxExposurePct: 30, maxOpenPositions: 2, maxDailyLossPct: 2, maxDrawdownPct: 10 },
  BALANCED: { riskPerTradePct: 1, maxExposurePct: 50, maxOpenPositions: 4, maxDailyLossPct: 4, maxDrawdownPct: 18 },
  AGGRESSIVE: { riskPerTradePct: 2, maxExposurePct: 75, maxOpenPositions: 6, maxDailyLossPct: 8, maxDrawdownPct: 30 },
};

export interface RiskLimits {
  riskPerTradePct: number;
  maxExposurePct: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
}

export function resolveRiskLimits(profile: RiskProfile, custom?: Partial<RiskLimits>): RiskLimits {
  if (profile === "CUSTOM") {
    return {
      riskPerTradePct: custom?.riskPerTradePct ?? 1,
      maxExposurePct: custom?.maxExposurePct ?? 50,
      maxOpenPositions: custom?.maxOpenPositions ?? 4,
      maxDailyLossPct: custom?.maxDailyLossPct ?? 4,
      maxDrawdownPct: custom?.maxDrawdownPct ?? 18,
    };
  }
  return RISK_PROFILE_DEFAULTS[profile];
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
  openNotional: number; // sum of existing open position notionals
  newNotional: number;
  limits: RiskLimits;
  openPositionCount: number;
}

export interface RiskCheckResult {
  passed: boolean;
  violations: string[];
  exposurePctAfter: number;
}

export function checkExposureLimits(input: ExposureCheckInput): RiskCheckResult {
  const violations: string[] = [];
  const totalNotional = input.openNotional + input.newNotional;
  const exposurePctAfter = input.equity > 0 ? (totalNotional / input.equity) * 100 : 100;

  if (exposurePctAfter > input.limits.maxExposurePct) {
    violations.push(`Projected exposure ${exposurePctAfter.toFixed(1)}% exceeds max ${input.limits.maxExposurePct}%.`);
  }
  if (input.openPositionCount + 1 > input.limits.maxOpenPositions) {
    violations.push(`Opening this position would exceed max open positions (${input.limits.maxOpenPositions}).`);
  }

  return { passed: violations.length === 0, violations, exposurePctAfter };
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
