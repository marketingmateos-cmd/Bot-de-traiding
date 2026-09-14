import { describe, expect, it } from "vitest";
import type { OHLCVBar } from "@/lib/providers/types";
import { resampleH1Bars } from "../resampleBars";

const HOUR_MS = 3_600_000;

function h1Bar(isoHourStart: string, o: number, h: number, l: number, c: number, v: number): OHLCVBar {
  return { timestamp: new Date(isoHourStart), open: o, high: h, low: l, close: c, volume: v };
}

/** 24 contiguous, deterministic H1 bars starting at a UTC day boundary — enough to build one full D1 bar and six full H4 bars. */
function buildOneFullDay(startIso: string): OHLCVBar[] {
  const startMs = new Date(startIso).getTime();
  const bars: OHLCVBar[] = [];
  for (let i = 0; i < 24; i++) {
    const base = 100 + i;
    bars.push({
      timestamp: new Date(startMs + i * HOUR_MS),
      open: base,
      high: base + 5 + (i % 3),
      low: base - 5 - (i % 2),
      close: base + 1,
      volume: 10 + i,
    });
  }
  return bars;
}

describe("resampleH1Bars — H4 aggregation", () => {
  it("aggregates 4 contiguous H1 bars into 1 H4 bar with correct OHLCV semantics", () => {
    const bars = [h1Bar("2024-01-01T00:00:00.000Z", 100, 110, 95, 105, 10), h1Bar("2024-01-01T01:00:00.000Z", 105, 108, 100, 102, 20), h1Bar("2024-01-01T02:00:00.000Z", 102, 120, 101, 118, 30), h1Bar("2024-01-01T03:00:00.000Z", 118, 119, 90, 95, 40)];
    const { bars: result, incompleteGroupsSkipped } = resampleH1Bars(bars, "H4");
    expect(incompleteGroupsSkipped).toBe(0);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(result[0].open).toBe(100); // first bar's open
    expect(result[0].close).toBe(95); // last bar's close
    expect(result[0].high).toBe(120); // max high across the 4
    expect(result[0].low).toBe(90); // min low across the 4
    expect(result[0].volume).toBe(100); // sum of volumes
  });

  it("aligns H4 groups to UTC 00/04/08/12/16/20 boundaries, never to the first bar's own hour", () => {
    const day = buildOneFullDay("2024-01-01T00:00:00.000Z");
    const { bars: result, incompleteGroupsSkipped } = resampleH1Bars(day, "H4");
    expect(incompleteGroupsSkipped).toBe(0);
    expect(result).toHaveLength(6);
    expect(result.map((b) => b.timestamp.toISOString())).toEqual(["2024-01-01T00:00:00.000Z", "2024-01-01T04:00:00.000Z", "2024-01-01T08:00:00.000Z", "2024-01-01T12:00:00.000Z", "2024-01-01T16:00:00.000Z", "2024-01-01T20:00:00.000Z"]);
  });

  it("skips a group with fewer than 4 bars (real gap) instead of silently aggregating a partial window", () => {
    const bars = [h1Bar("2024-01-01T00:00:00.000Z", 100, 110, 95, 105, 10), h1Bar("2024-01-01T01:00:00.000Z", 105, 108, 100, 102, 20), h1Bar("2024-01-01T03:00:00.000Z", 118, 119, 90, 95, 40)]; // missing hour 02
    const { bars: result, incompleteGroupsSkipped } = resampleH1Bars(bars, "H4");
    expect(result).toHaveLength(0);
    expect(incompleteGroupsSkipped).toBe(1);
  });

  it("is order-independent — shuffled input produces the same result as chronologically sorted input", () => {
    const bars = [h1Bar("2024-01-01T02:00:00.000Z", 102, 120, 101, 118, 30), h1Bar("2024-01-01T00:00:00.000Z", 100, 110, 95, 105, 10), h1Bar("2024-01-01T03:00:00.000Z", 118, 119, 90, 95, 40), h1Bar("2024-01-01T01:00:00.000Z", 105, 108, 100, 102, 20)];
    const { bars: result } = resampleH1Bars(bars, "H4");
    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(100);
    expect(result[0].close).toBe(95);
  });
});

describe("resampleH1Bars — D1 aggregation", () => {
  it("aggregates 24 contiguous H1 bars into 1 D1 bar with correct OHLCV semantics", () => {
    const day = buildOneFullDay("2024-01-01T00:00:00.000Z");
    const { bars: result, incompleteGroupsSkipped } = resampleH1Bars(day, "D1");
    expect(incompleteGroupsSkipped).toBe(0);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(result[0].open).toBe(day[0].open);
    expect(result[0].close).toBe(day[23].close);
    expect(result[0].high).toBe(Math.max(...day.map((b) => b.high)));
    expect(result[0].low).toBe(Math.min(...day.map((b) => b.low)));
    expect(result[0].volume).toBeCloseTo(day.reduce((s, b) => s + b.volume, 0), 10);
  });

  it("skips a day with a missing hour (the real Fase 21 gap pattern: 23 of 24 hours present) — never fills it", () => {
    const day = buildOneFullDay("2024-01-01T00:00:00.000Z").filter((b) => b.timestamp.toISOString() !== "2024-01-01T13:00:00.000Z");
    expect(day).toHaveLength(23);
    const { bars: result, incompleteGroupsSkipped } = resampleH1Bars(day, "D1");
    expect(result).toHaveLength(0);
    expect(incompleteGroupsSkipped).toBe(1);
  });

  it("aligns D1 groups to UTC midnight, not to the first bar's own timestamp", () => {
    const twoDays = [...buildOneFullDay("2024-01-01T00:00:00.000Z"), ...buildOneFullDay("2024-01-02T00:00:00.000Z")];
    const { bars: result } = resampleH1Bars(twoDays, "D1");
    expect(result).toHaveLength(2);
    expect(result[0].timestamp.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(result[1].timestamp.toISOString()).toBe("2024-01-02T00:00:00.000Z");
  });
});

describe("resampleH1Bars — determinism and non-mutation", () => {
  it("is fully deterministic — same input, same output, across two independent calls", () => {
    const day = buildOneFullDay("2024-01-01T00:00:00.000Z");
    const a = resampleH1Bars(day, "H4");
    const b = resampleH1Bars(day, "H4");
    expect(a).toEqual(b);
  });

  it("never mutates the input bars array or its bar objects", () => {
    const day = buildOneFullDay("2024-01-01T00:00:00.000Z");
    const snapshot = JSON.parse(JSON.stringify(day));
    resampleH1Bars(day, "D1");
    expect(JSON.parse(JSON.stringify(day))).toEqual(snapshot);
  });

  it("returns an empty result (no throw) for an empty input", () => {
    const { bars, incompleteGroupsSkipped } = resampleH1Bars([], "H4");
    expect(bars).toEqual([]);
    expect(incompleteGroupsSkipped).toBe(0);
  });
});
