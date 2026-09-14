import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";

/**
 * Aggregates H1 bars into H4 or D1 bars, aligned to UTC boundaries (H4:
 * 00/04/08/12/16/20; D1: 00:00). Reused by any future timeframe expansion
 * — never a per-caller reimplementation of OHLCV aggregation.
 *
 * A group is only emitted if it has EXACTLY the expected number of
 * consecutive, contiguous H1 bars (4 for H4, 24 for D1) — a group that is
 * short (a real gap in the source, like the 2023-03-24T13:00Z gap already
 * documented in Fase 21) is skipped, never silently completed with a
 * partial/interpolated candle. This mirrors the "never fill gaps silently"
 * rule already applied to raw import (Fase 9/21).
 */

export type ResampleTargetTimeframe = Extract<TimeframeCode, "H4" | "D1">;

export interface ResampleResult {
  bars: OHLCVBar[];
  /** Number of source-bar groups that did NOT produce a target bar, because they were short or non-contiguous (a real gap fell inside that window). */
  incompleteGroupsSkipped: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BARS_PER_GROUP: Record<ResampleTargetTimeframe, number> = { H4: 4, D1: 24 };

function groupStartMs(barMs: number, target: ResampleTargetTimeframe): number {
  if (target === "H4") {
    const hourIndex = Math.floor(barMs / HOUR_MS);
    return Math.floor(hourIndex / 4) * 4 * HOUR_MS;
  }
  return Math.floor(barMs / DAY_MS) * DAY_MS;
}

export function resampleH1Bars(bars: OHLCVBar[], target: ResampleTargetTimeframe): ResampleResult {
  const expectedCount = BARS_PER_GROUP[target];
  const groups = new Map<number, OHLCVBar[]>();
  for (const bar of bars) {
    const key = groupStartMs(bar.timestamp.getTime(), target);
    const bucket = groups.get(key);
    if (bucket) bucket.push(bar);
    else groups.set(key, [bar]);
  }

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  const resultBars: OHLCVBar[] = [];
  let incompleteGroupsSkipped = 0;

  for (const key of sortedKeys) {
    const group = groups.get(key)!.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (group.length !== expectedCount) {
      incompleteGroupsSkipped++;
      continue;
    }
    let contiguous = true;
    for (let i = 1; i < group.length; i++) {
      if (group[i].timestamp.getTime() - group[i - 1].timestamp.getTime() !== HOUR_MS) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) {
      incompleteGroupsSkipped++;
      continue;
    }

    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
    }
    resultBars.push({
      timestamp: new Date(key),
      open: group[0].open,
      high,
      low,
      close: group[group.length - 1].close,
      volume,
    });
  }

  return { bars: resultBars, incompleteGroupsSkipped };
}
