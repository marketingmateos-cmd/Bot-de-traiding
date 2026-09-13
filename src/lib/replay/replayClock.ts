/**
 * Fase 7 — ReplayClock. Enforces "el reloj del replay debe avanzar
 * cronológicamente" (spec) as a structural property, not a convention: the
 * only way to read the current instant is `current()`, the only way to
 * move is `advance()`, and `advance()` can only ever move forward — there
 * is no method on this class capable of rewinding or jumping ahead.
 *
 * Timestamps come from the UNION of every asset's own bar timestamps in
 * the run, sorted ascending, so a replay stays correct even if different
 * assets have slightly different gaps in their series — every asset is
 * still only ever read up to (never past) the clock's current instant.
 */
export class ReplayClock {
  private readonly timestamps: number[];
  private index = -1;

  constructor(timestampsMs: number[]) {
    const unique = Array.from(new Set(timestampsMs));
    unique.sort((a, b) => a - b);
    this.timestamps = unique;
  }

  get length(): number {
    return this.timestamps.length;
  }

  hasNext(): boolean {
    return this.index + 1 < this.timestamps.length;
  }

  /** Advances one tick forward and returns the new current timestamp (ms). Throws if already at the end. */
  advance(): number {
    if (!this.hasNext()) throw new Error("ReplayClock: no more ticks — advance() called past the end of the timeline.");
    this.index++;
    return this.timestamps[this.index];
  }

  /** The clock's current instant (ms since epoch), or null before the first advance(). */
  current(): number | null {
    return this.index >= 0 ? this.timestamps[this.index] : null;
  }

  get tickIndex(): number {
    return this.index;
  }
}

/**
 * Truncates a bar series to only what would have been visible AT OR BEFORE
 * `asOfMs` — the single chokepoint every part of the replay engine must go
 * through to read market data. No strategy, indicator, regime detector, AI
 * call, or Trade Gate check in the replay path is ever handed the full
 * series; they only ever see what this function returns.
 */
export function barsAsOf<T extends { timestamp: Date }>(bars: T[], asOfMs: number): T[] {
  // Bars are chronologically sorted by construction (historicalDataProvider
  // guarantees this); a linear scan from the end is fine at replay scale
  // (a few thousand bars) and keeps this function trivially auditable.
  let end = bars.length;
  while (end > 0 && bars[end - 1].timestamp.getTime() > asOfMs) end--;
  return bars.slice(0, end);
}
