import type { OHLCVBar } from "@/lib/providers/types";
import { atr } from "@/lib/engines/features";

/**
 * Fase 20-E — Compression Duration ("Coiling Length"). A standalone
 * reimplementation of the ATR-percentile-rank compression test already
 * used by Fase 17-A (`research/volatilitySqueeze.ts`) — deliberately NOT
 * imported from that file and NOT modifying it (spec Condición 5/11: the
 * 5 existing research strategies must never change). F20-E's genuinely
 * new contribution is `computeCoilLength`, which F17-A has no equivalent
 * of: F17-A only checks the state of the single bar immediately before a
 * breakout, while F20-E counts how many CONSECUTIVE prior bars were
 * already compressed.
 */

/**
 * For each bar index i, the percentile rank (0-100) of atr[i] within the
 * trailing `squeezeLookback` ATR values BEFORE i (never including i
 * itself, so this is causal: the rank at i depends only on bars
 * [i - squeezeLookback, i)). Null where there isn't enough trailing
 * history.
 */
export function computeAtrPercentileRanks(bars: OHLCVBar[], atrPeriod: number, squeezeLookback: number): (number | null)[] {
  const atrArr = atr(bars, atrPeriod);
  const ranks: (number | null)[] = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i++) {
    const current = atrArr[i];
    if (current === null || current <= 0) continue;
    const history = atrArr.slice(Math.max(0, i - squeezeLookback), i).filter((v): v is number => v !== null && v > 0);
    if (history.length < squeezeLookback * 0.8) continue;
    const rank = (history.filter((v) => v <= current).length / history.length) * 100;
    ranks[i] = rank;
  }
  return ranks;
}

/**
 * The number of consecutive bars ENDING AT (and including) `index` whose
 * ATR percentile rank is at or below `squeezePercentile` — i.e. how long
 * the market has been "coiled" as of this bar. Causal: only looks
 * backward from `index`. Returns 0 if the bar at `index` itself is not
 * compressed.
 */
export function computeCoilLength(percentileRanks: (number | null)[], index: number, squeezePercentile: number): number {
  let length = 0;
  for (let i = index; i >= 0; i--) {
    const rank = percentileRanks[i];
    if (rank === null || rank > squeezePercentile) break;
    length++;
  }
  return length;
}
