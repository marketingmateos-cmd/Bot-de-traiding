import type { OHLCVBar } from "@/lib/providers/types";
import { ema, realizedVolatility, sma } from "./features";

export type Regime =
  | "STRONG_BULL"
  | "BULL"
  | "NEUTRAL"
  | "BEAR"
  | "STRONG_BEAR"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "RANGE"
  | "TRANSITION";

export interface RegimeResult {
  regime: Regime;
  confidence: number; // 0-1
  details: {
    trendSlopePct: number;
    volatilityPercentile: number; // 0-100 vs trailing history
    rangeWidthPct: number;
  };
}

/**
 * Market Regime Engine (spec §9). Classifies the current regime from trend
 * slope, trailing volatility percentile, and price range compression.
 * Strategies consult this to know whether they're allowed to fire (see
 * strategy/types.ts `recommendedRegimes`).
 */
export function detectRegime(bars: OHLCVBar[]): RegimeResult {
  const closes = bars.map((b) => b.close);
  if (closes.length < 60) {
    return { regime: "TRANSITION", confidence: 0.2, details: { trendSlopePct: 0, volatilityPercentile: 50, rangeWidthPct: 0 } };
  }

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const last = closes.length - 1;
  const price = closes[last];

  const e20 = ema20[last];
  const e50 = ema50[last];
  const trendSlopePct = e20 !== null && e50 !== null ? ((e20 - e50) / price) * 100 : 0;

  const vol = realizedVolatility(closes, 20);
  const volSeries = vol.filter((v): v is number => v !== null);
  const currentVol = volSeries[volSeries.length - 1] ?? 0;
  const volatilityPercentile =
    volSeries.length > 10
      ? (volSeries.filter((v) => v <= currentVol).length / volSeries.length) * 100
      : 50;

  const window = closes.slice(-30);
  const rangeWidthPct = ((Math.max(...window) - Math.min(...window)) / price) * 100;

  let regime: Regime;
  let confidence: number;

  if (volatilityPercentile > 88) {
    regime = "HIGH_VOLATILITY";
    confidence = 0.6 + (volatilityPercentile - 88) / 100;
  } else if (volatilityPercentile < 15) {
    regime = "LOW_VOLATILITY";
    confidence = 0.55 + (15 - volatilityPercentile) / 100;
  } else if (trendSlopePct > 3) {
    regime = "STRONG_BULL";
    confidence = Math.min(0.95, 0.5 + trendSlopePct / 20);
  } else if (trendSlopePct > 0.8) {
    regime = "BULL";
    confidence = 0.55 + trendSlopePct / 20;
  } else if (trendSlopePct < -3) {
    regime = "STRONG_BEAR";
    confidence = Math.min(0.95, 0.5 + Math.abs(trendSlopePct) / 20);
  } else if (trendSlopePct < -0.8) {
    regime = "BEAR";
    confidence = 0.55 + Math.abs(trendSlopePct) / 20;
  } else if (rangeWidthPct < 6) {
    regime = "RANGE";
    confidence = 0.5 + (6 - rangeWidthPct) / 12;
  } else {
    regime = "NEUTRAL";
    confidence = 0.4;
  }

  return {
    regime,
    confidence: Math.max(0, Math.min(1, confidence)),
    details: { trendSlopePct, volatilityPercentile, rangeWidthPct },
  };
}

/**
 * Regime compatibility is decided from each strategy's OWN declared
 * `recommendedRegimes` (set on its StrategyDefinition and mirrored into its
 * StrategyVersion row) — never from a separate hardcoded table keyed by
 * strategy kind. That keeps the DB-editable `recommendedRegimes` field the
 * single source of truth: changing it on a version actually changes gating.
 * An empty list means "no regime restriction declared" and is always compatible.
 */
export function isRegimeCompatible(allowedRegimes: Regime[], regime: Regime): boolean {
  return allowedRegimes.length === 0 || allowedRegimes.includes(regime);
}
