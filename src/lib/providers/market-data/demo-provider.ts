import type { MarketDataProvider, MarketDataResult, OHLCVBar, TimeframeCode } from "../types";
import { gaussian, hashStringToSeed, mulberry32 } from "./seeded-random";

const BASE_PRICES: Record<string, number> = {
  BTC: 62000,
  ETH: 3100,
  SOL: 145,
  XRP: 0.58,
  BNB: 560,
  DOGE: 0.14,
  ADA: 0.42,
};

const TIMEFRAME_MS: Record<TimeframeCode, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

// The synthetic walk is always simulated for this many bars internally,
// anchored to a count-independent "now" bucket (see anchorIndex below), and
// only the most recent `count` bars are returned. This is the root-cause fix
// for demo price incoherence: previously the walk length WAS `count`, so
// asking for 50 vs 200 bars re-walked the same RNG stream for a different
// number of compounding steps and landed on two different "current" prices
// for the same instant. Chosen comfortably above the largest `limit` used
// anywhere in the codebase (backtest/walk-forward/robustness routes request
// up to ~1500 bars) so all realistic call sites share one canonical walk.
const CANONICAL_WALK_LENGTH = 4096;

/**
 * Generates a synthetic OHLCV series with regime cycles (trending / ranging /
 * volatile phases) via a regime-switching random walk, so downstream engines
 * (regime detection, indicators, strategies) have realistic structure to work
 * with.
 *
 * Coherence guarantee: the walk is anchored to `anchorIndex`, a bucket of
 * `Date.now()` that only depends on (timeframe, wall-clock time) — never on
 * the caller's requested `count`. The full canonical walk (`CANONICAL_WALK_LENGTH`
 * bars ending at `anchorIndex`) is simulated from the same seed every time,
 * and callers only see a tail slice of it. So two calls for the same
 * (symbol, timeframe) made at essentially the same instant — regardless of
 * how many bars each requests — always agree on the price/timestamp of the
 * most recent bar, and on the value of any bar index they both cover.
 */
function generateSeries(symbol: string, timeframe: TimeframeCode, count: number): OHLCVBar[] {
  const anchorIndex = Math.floor(Date.now() / TIMEFRAME_MS[timeframe]);
  return walkSeries(symbol, timeframe, anchorIndex, Math.max(CANONICAL_WALK_LENGTH, count)).slice(-count);
}

/**
 * Fase 7 — Historical Replay needs this exact same regime-switching walk,
 * but anchored to an arbitrary historical `endDate` instead of `Date.now()`,
 * so a replay of "Jan-Jun 2025" always reproduces the identical bars no
 * matter when it's actually run (determinism requirement, spec rule #6) —
 * never a live "now"-relative price. Pulled out of `generateSeries` as a
 * pure function of (symbol, timeframe, anchorIndex, length) so both the
 * live provider (anchored to now) and this historical path (anchored to
 * `endDate`) share one implementation; `generateSeries`'s own behavior is
 * unchanged (see demo-provider.test.ts / demo-provider.audit.test.ts).
 * Always labeled synthetic by its caller — never presented as real
 * historical market data (see replay/historicalDataProvider.ts).
 */
export function generateHistoricalWalk(symbol: string, timeframe: TimeframeCode, startDate: Date, endDate: Date): OHLCVBar[] {
  const stepMs = TIMEFRAME_MS[timeframe];
  const anchorIndex = Math.floor(endDate.getTime() / stepMs);
  const requestedCount = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / stepMs) + 1);
  const internalLength = Math.max(CANONICAL_WALK_LENGTH, requestedCount);
  const bars = walkSeries(symbol.toUpperCase(), timeframe, anchorIndex, internalLength);
  return bars.filter((b) => b.timestamp.getTime() >= startDate.getTime() && b.timestamp.getTime() <= endDate.getTime());
}

/**
 * Pure regime-switching random walk of `length` bars ending at
 * `anchorIndex` (a bucket index of `stepMs` since the epoch) — no reference
 * to wall-clock time anywhere in here, so the same (symbol, timeframe,
 * anchorIndex, length) always reproduces byte-identical bars.
 */
function walkSeries(symbol: string, timeframe: TimeframeCode, anchorIndex: number, length: number): OHLCVBar[] {
  const base = BASE_PRICES[symbol] ?? 100;
  const seed = hashStringToSeed(`${symbol}:${timeframe}`);
  const rand = mulberry32(seed);
  const stepMs = TIMEFRAME_MS[timeframe];

  const internalLength = length;
  const start = (anchorIndex - internalLength + 1) * stepMs;

  const bars: OHLCVBar[] = [];
  let price = base * (0.85 + rand() * 0.3);
  let regimeBiasPerBar = 0;
  let regimeVol = 0.006;
  let regimeBarsLeft = 0;

  for (let i = 0; i < internalLength; i++) {
    if (regimeBarsLeft <= 0) {
      const regimeRoll = rand();
      if (regimeRoll < 0.28) {
        regimeBiasPerBar = 0.0009 + rand() * 0.0012; // bull
        regimeVol = 0.005 + rand() * 0.004;
      } else if (regimeRoll < 0.5) {
        regimeBiasPerBar = -(0.0009 + rand() * 0.0012); // bear
        regimeVol = 0.006 + rand() * 0.005;
      } else if (regimeRoll < 0.78) {
        regimeBiasPerBar = (rand() - 0.5) * 0.0004; // range
        regimeVol = 0.003 + rand() * 0.002;
      } else {
        regimeBiasPerBar = (rand() - 0.5) * 0.0015; // high volatility
        regimeVol = 0.012 + rand() * 0.01;
      }
      regimeBarsLeft = 30 + Math.floor(rand() * 120);
    }
    regimeBarsLeft--;

    const shock = gaussian(rand) * regimeVol;
    const drift = regimeBiasPerBar;
    const open = price;
    const close = Math.max(0.000001, open * (1 + drift + shock));
    const wickUp = Math.abs(gaussian(rand)) * regimeVol * 0.6;
    const wickDown = Math.abs(gaussian(rand)) * regimeVol * 0.6;
    const high = Math.max(open, close) * (1 + wickUp);
    const low = Math.min(open, close) * (1 - wickDown);
    const volumeBase = base * 1200 * (0.5 + rand());
    const volume = volumeBase * (1 + Math.abs(shock) * 15);

    bars.push({
      timestamp: new Date(start + i * stepMs),
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }

  return bars;
}

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = "demo";
  readonly isDemo = true;

  async getOHLCV(symbol: string, timeframe: TimeframeCode, limit: number): Promise<MarketDataResult> {
    const bars = generateSeries(symbol.toUpperCase(), timeframe, limit);
    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      bars,
      source: this.id,
      isDemo: true,
      fetchedAt: new Date(),
    };
  }

  async getLatestPrice(symbol: string): Promise<{ price: number; timestamp: Date } | null> {
    const bars = generateSeries(symbol.toUpperCase(), "M5", 2);
    const last = bars[bars.length - 1];
    if (!last) return null;
    return { price: last.close, timestamp: last.timestamp };
  }
}
