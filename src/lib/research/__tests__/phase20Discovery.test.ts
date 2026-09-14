import { describe, expect, it } from "vitest";
import type { OHLCVBar } from "@/lib/providers/types";
import { tagAsIsOnly, DiscoveryContaminationError, type IsOnlyBars } from "../phase20Discovery";
import { FROZEN_RANGES } from "../phase20PreRegistration";

function bar(timestamp: Date): OHLCVBar {
  return { timestamp, open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
}

/** Stand-in for a Discovery-stage function whose signature REQUIRES the branded type — proves the type barrier compiles. */
function fakeDiscoveryFunction(bars: IsOnlyBars): number {
  return bars.length;
}

describe("Fase 20 — Discovery structural contamination barrier (Condición 2)", () => {
  it("accepts bars strictly within the IS range", () => {
    const bars = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.is.start.getTime() + 3_600_000))];
    const tagged = tagAsIsOnly(bars);
    expect(fakeDiscoveryFunction(tagged)).toBe(2);
  });

  it("throws DiscoveryContaminationError when a single bar is dated after FROZEN_RANGES.is.end", () => {
    const bars = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.is.end.getTime() + 3_600_000))];
    expect(() => tagAsIsOnly(bars)).toThrow(DiscoveryContaminationError);
  });

  it("throws even when only the LAST bar in an otherwise-valid array crosses into VALIDATION territory", () => {
    const validationBar = bar(new Date(FROZEN_RANGES.validation.start.getTime() + 3_600_000));
    const bars = [bar(FROZEN_RANGES.is.start), bar(new Date(FROZEN_RANGES.is.start.getTime() + 3_600_000)), validationBar];
    expect(() => tagAsIsOnly(bars)).toThrow(DiscoveryContaminationError);
  });

  it("throws even when only the LAST bar crosses into OOS territory (extreme-future-value cannot sneak in)", () => {
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
});
