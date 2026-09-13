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
  /**
   * The sizing engine's own ideal, risk-based notional for this candidate
   * (from `calculatePositionSize`) — a REQUEST, not a guarantee. This
   * function may approve a SMALLER notional than requested (see
   * `approvedNotional`); it never approves more.
   */
  requestedNotional: number;
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
  /**
   * Fase 5 — sum of open notional in OTHER assets (never the candidate's
   * own — that's `assetOpenNotional`) whose recent returns are highly
   * correlated with it. Checked against the same maxConcentrationPct so
   * several different-but-correlated assets (e.g. BTC and ETH moving
   * together) can't quietly recreate the exact concentrated bet the
   * same-asset check alone would catch — real portfolio risk, not a
   * per-symbol technicality. Defaults to 0 (no correlation data available)
   * so this check is a strict addition, never a new way to be MORE
   * permissive than before.
   */
  correlatedOpenNotional: number;
}

export type RiskViolationKind = "EXPOSURE" | "POSITION_SIZE" | "CONCENTRATION" | "CORRELATION";

export interface RiskCheckResult {
  /** True iff SOME nonzero notional can be opened — see `approvedNotional`. */
  passed: boolean;
  /**
   * Fase "Risk Level coherence audit" — the notional the caller should
   * actually size the trade to. Reduced (never increased) from
   * `requestedNotional` when the full risk-based size would breach
   * exposure/concentration/correlation; 0 when `passed` is false. The
   * stop distance and the monetary risk-per-trade TARGET are never
   * touched — only how much of that target is actually deployed, so a
   * trade that doesn't fully fit still opens at whatever size honestly
   * does, rather than being blocked outright (spec: "no forzar ninguna
   * operación" AND "no bloquear si puede reducirse de forma coherente").
   */
  approvedNotional: number;
  /** True when `approvedNotional < requestedNotional` — the position was reduced, not blocked. */
  wasClamped: boolean;
  /** Reasons for an outright reject (passed=false) — position-count is the one dimension that can never be "partially" satisfied by shrinking notional. */
  violations: string[];
  /** Machine-readable tag per violation, same order as `violations` — feeds RiskEvent.kind (Fase 2). */
  violationKinds: RiskViolationKind[];
  /** Informational: which cap(s) reduced (but did not block) the size — never a reason to alarm, just to explain the smaller-than-ideal position. */
  clampReasons: string[];
  /** Machine-readable tag per clamp reason, same order as `clampReasons`. */
  clampKinds: RiskViolationKind[];
  /** Computed from `approvedNotional` — what will ACTUALLY be true after this trade, not what was merely requested. */
  exposurePctAfter: number;
}

const CLAMP_EPSILON = 1e-9;

/**
 * Fase "Risk Level coherence audit". Root cause this fixes: `calculatePositionSize`'s
 * risk-based notional (equity * riskPerTradePct / stopLossPct) and this
 * function's caps (maxExposurePct/maxConcentrationPct) were checked as an
 * all-or-nothing gate — any breach BLOCKED the whole trade. Because
 * `riskPerTradePct` grows ~10x from Risk Level 1 to 10 while
 * `maxConcentrationPct` only grows ~4.5x, and every built-in strategy's
 * `defaultStopLossPct` is tight (2-4%), the risk-based notional outgrows
 * the concentration cap at nearly every level above 1 — so raising the
 * Risk Level made a trade MORE likely to be rejected outright, not more
 * likely to trade bigger. See README's "Historical Replay" section for the
 * full numeric audit (Risk Level 1-10 × a 3%-stop strategy).
 *
 * The fix: exposure/concentration/correlation are now a CEILING that
 * clamps the requested notional down to whatever headroom remains, never
 * an all-or-nothing gate — the stop distance and the risk-per-trade
 * TARGET are untouched, only how much of that target's notional is
 * actually deployable. Position COUNT (`maxOpenPositions`) is the one
 * dimension that stays a hard, unclampable reject: you cannot "partially"
 * open a position slot. A request that has zero headroom anywhere (or hits
 * the position-count cap) is still rejected cleanly (`passed: false`,
 * `approvedNotional: 0`) — this never forces a trade that doesn't fit at
 * all, it only stops REJECTING one that fits at a smaller, honest size.
 */
export function checkExposureLimits(input: ExposureCheckInput): RiskCheckResult {
  const violations: string[] = [];
  const violationKinds: RiskViolationKind[] = [];
  const clampReasons: string[] = [];
  const clampKinds: RiskViolationKind[] = [];

  const positionCountExceeded = input.openPositionCount + 1 > input.limits.maxOpenPositions;
  if (positionCountExceeded) {
    violations.push(`Abrir esta posición superaría el máximo de posiciones abiertas (${input.limits.maxOpenPositions}).`);
    violationKinds.push("POSITION_SIZE");
  }

  if (input.equity <= 0 || input.requestedNotional <= 0 || positionCountExceeded) {
    return {
      passed: false,
      approvedNotional: 0,
      wasClamped: false,
      violations,
      violationKinds,
      clampReasons,
      clampKinds,
      exposurePctAfter: input.equity > 0 ? (input.openNotional / input.equity) * 100 : 100,
    };
  }

  const exposureCap = (input.limits.maxExposurePct / 100) * input.equity;
  const exposureHeadroom = Math.max(0, exposureCap - input.openNotional);

  const concentrationCap = (input.limits.maxConcentrationPct / 100) * input.equity;
  const concentrationHeadroom = Math.max(0, concentrationCap - input.assetOpenNotional);

  // Only meaningful when there IS existing correlated exposure to combine
  // with — otherwise this would just restate "this one trade is too big"
  // (already covered by exposure/concentration above) under a misleading
  // "correlation" label, so it imposes no cap of its own in that case.
  const correlationHeadroom = input.correlatedOpenNotional > 0 ? Math.max(0, concentrationCap - input.correlatedOpenNotional) : Infinity;

  const approvedNotional = Math.min(input.requestedNotional, exposureHeadroom, concentrationHeadroom, correlationHeadroom);

  if (approvedNotional <= CLAMP_EPSILON) {
    if (exposureHeadroom <= CLAMP_EPSILON) {
      violations.push(`No queda margen de exposición: ya al ${((input.openNotional / input.equity) * 100).toFixed(1)}% del máximo de ${input.limits.maxExposurePct}%.`);
      violationKinds.push("EXPOSURE");
    }
    if (concentrationHeadroom <= CLAMP_EPSILON) {
      violations.push(`No queda margen de concentración en este activo: ya al ${((input.assetOpenNotional / input.equity) * 100).toFixed(1)}% del máximo de ${input.limits.maxConcentrationPct}% por activo.`);
      violationKinds.push("CONCENTRATION");
    }
    if (correlationHeadroom <= CLAMP_EPSILON) {
      violations.push(`No queda margen frente a activos correlacionados: ya al ${((input.correlatedOpenNotional / input.equity) * 100).toFixed(1)}% del máximo de concentración de ${input.limits.maxConcentrationPct}%.`);
      violationKinds.push("CORRELATION");
    }
    return { passed: false, approvedNotional: 0, wasClamped: false, violations, violationKinds, clampReasons, clampKinds, exposurePctAfter: (input.openNotional / input.equity) * 100 };
  }

  const wasClamped = approvedNotional < input.requestedNotional - CLAMP_EPSILON;
  if (wasClamped) {
    if (Math.abs(approvedNotional - exposureHeadroom) <= CLAMP_EPSILON) {
      clampReasons.push(`Tamaño reducido de ${input.requestedNotional.toFixed(2)} a ${approvedNotional.toFixed(2)} para no superar la exposición máxima del ${input.limits.maxExposurePct}%.`);
      clampKinds.push("EXPOSURE");
    }
    if (Math.abs(approvedNotional - concentrationHeadroom) <= CLAMP_EPSILON) {
      clampReasons.push(`Tamaño reducido de ${input.requestedNotional.toFixed(2)} a ${approvedNotional.toFixed(2)} para no superar la concentración máxima del ${input.limits.maxConcentrationPct}% en este activo.`);
      clampKinds.push("CONCENTRATION");
    }
    if (Math.abs(approvedNotional - correlationHeadroom) <= CLAMP_EPSILON) {
      clampReasons.push(`Tamaño reducido de ${input.requestedNotional.toFixed(2)} a ${approvedNotional.toFixed(2)} por exposición combinada a activos correlacionados.`);
      clampKinds.push("CORRELATION");
    }
  }

  const exposurePctAfter = ((input.openNotional + approvedNotional) / input.equity) * 100;
  return { passed: true, approvedNotional, wasClamped, violations, violationKinds, clampReasons, clampKinds, exposurePctAfter };
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
