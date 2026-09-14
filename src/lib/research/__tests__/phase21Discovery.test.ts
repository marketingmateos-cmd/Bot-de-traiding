import { describe, expect, it } from "vitest";
import type { OHLCVBar } from "@/lib/providers/types";
import { tagAsIsOnly, DiscoveryContaminationError, type IsOnlyBars } from "../phase21Discovery";
import { FROZEN_RANGES } from "../phase21PreRegistration";

function bar(timestamp: Date): OHLCVBar {
  return { timestamp, open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
}

function fakeDiscoveryFunction(bars: IsOnlyBars): number {
  return bars.length;
}

describe("Fase 21 — Discovery structural contamination barrier", () => {
  it("accepts bars strictly within the IS range", () => {
    const bars = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.is.start.getTime() + 3_600_000))];
    const tagged = tagAsIsOnly(bars);
    expect(fakeDiscoveryFunction(tagged)).toBe(2);
  });

  it("throws when a bar is dated after FROZEN_RANGES.is.end", () => {
    const bars = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.is.end.getTime() + 3_600_000))];
    expect(() => tagAsIsOnly(bars)).toThrow(DiscoveryContaminationError);
  });

  it("throws even when only the LAST bar crosses into VALIDATION territory", () => {
    const validationBar = bar(new Date(FROZEN_RANGES.validation.start.getTime() + 3_600_000));
    const bars = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.is.start.getTime() + 3_600_000)), validationBar];
    expect(() => tagAsIsOnly(bars)).toThrow(DiscoveryContaminationError);
  });

  it("throws even when only the LAST bar crosses into OOS territory", () => {
    const oosBar = bar(new Date(FROZEN_RANGES.oos.start.getTime() + 3_600_000));
    const bars = [bar(FROZEN_RANGES.is.start), oosBar];
    expect(() => tagAsIsOnly(bars)).toThrow(DiscoveryContaminationError);
  });

  it("throws on an empty array", () => {
    expect(() => tagAsIsOnly([])).toThrow(DiscoveryContaminationError);
  });

  it("throws when bars are out of chronological order", () => {
    const bars = [bar(new Date(FROZEN_RANGES.is.start.getTime() + 3_600_000)), bar(FROZEN_RANGES.is.start)];
    expect(() => tagAsIsOnly(bars)).toThrow(DiscoveryContaminationError);
  });

  it("accepts a bar exactly AT the IS end boundary (inclusive)", () => {
    const bars = [bar(FROZEN_RANGES.is.start), bar(FROZEN_RANGES.is.end)];
    expect(() => tagAsIsOnly(bars)).not.toThrow();
  });

  it("F21's own barrier is bound to F21's own (wider) IS range, distinct from F20's", () => {
    // Sanity check that this module didn't accidentally import F20's FROZEN_RANGES —
    // F21's IS end must be far later than F20's IS end (F20's dataset only spans 6 months total).
    expect(FROZEN_RANGES.is.end.getFullYear()).toBeGreaterThanOrEqual(2025);
  });
});
