import { describe, expect, it } from "vitest";
import { ReplayClock, barsAsOf } from "../replayClock";

describe("AUDIT: ReplayClock advances strictly chronologically, never backward (Fase 7 STEP 1-2)", () => {
  it("advances through T0 -> T1 -> T2 in strictly increasing order", () => {
    const clock = new ReplayClock([3000, 1000, 2000, 1000]); // unsorted + duplicate on purpose
    expect(clock.current()).toBeNull();
    const t0 = clock.advance();
    const t1 = clock.advance();
    const t2 = clock.advance();
    expect([t0, t1, t2]).toEqual([1000, 2000, 3000]);
    expect(clock.hasNext()).toBe(false);
  });

  it("de-duplicates identical timestamps from different assets into one tick", () => {
    const clock = new ReplayClock([1000, 1000, 1000]);
    expect(clock.length).toBe(1);
  });

  it("throws rather than silently returning stale data when advanced past the end", () => {
    const clock = new ReplayClock([1000]);
    clock.advance();
    expect(() => clock.advance()).toThrow();
  });
});

describe("AUDIT: barsAsOf never reveals a bar after the current instant (zero look-ahead)", () => {
  const bars = [1000, 2000, 3000, 4000, 5000].map((t) => ({ timestamp: new Date(t), close: t }));

  it("includes bars up to and including the exact current timestamp", () => {
    const window = barsAsOf(bars, 3000);
    expect(window.map((b) => b.timestamp.getTime())).toEqual([1000, 2000, 3000]);
  });

  it("rejects future data: a timestamp between two bars only ever sees the earlier one", () => {
    const window = barsAsOf(bars, 3500);
    expect(window.map((b) => b.timestamp.getTime())).toEqual([1000, 2000, 3000]);
  });

  it("returns an empty window before the first bar — never fabricates history", () => {
    expect(barsAsOf(bars, 500)).toEqual([]);
  });

  it("never returns a reference to bars beyond asOfMs even at the exact last timestamp", () => {
    const window = barsAsOf(bars, 5000);
    expect(window).toHaveLength(5);
    expect(window[window.length - 1].timestamp.getTime()).toBe(5000);
  });
});
