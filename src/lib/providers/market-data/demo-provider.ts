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

/**
 * Generates a synthetic OHLCV series with regime cycles (trending / ranging /
 * volatile phases) via a regime-switching random walk, so downstream engines
 * (regime detection, indicators, strategies) have realistic structure to work
 * with. Deterministic per (symbol, timeframe) so repeated calls & tests are
 * stable within reasonable cache windows, but re-seeds by day so "today" still
 * moves.
 */
function generateSeries(symbol: string, timeframe: TimeframeCode, count: number): OHLCVBar[] {
  const base = BASE_PRICES[symbol] ?? 100;
  const daySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 6)); // reseed every 6h
  const seed = hashStringToSeed(`${symbol}:${timeframe}:${daySeed}`);
  const rand = mulberry32(seed);
  const stepMs = TIMEFRAME_MS[timeframe];

  const bars: OHLCVBar[] = [];
  let price = base * (0.85 + rand() * 0.3);
  let regimeBiasPerBar = 0;
  let regimeVol = 0.006;
  let regimeBarsLeft = 0;
  const now = Date.now();
  const start = now - count * stepMs;

  for (let i = 0; i < count; i++) {
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
