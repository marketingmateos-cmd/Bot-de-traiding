import { describe, expect, it } from "vitest";
import { validateCandleBatch } from "../candleValidation";
import { makeBar } from "./testFixtures";

describe("Fase 9 test #4 — validación OHLCV: nunca insertar datos inválidos silenciosamente", () => {
  it("accepts a well-formed ascending batch entirely", () => {
    const bars = [makeBar(1000, 100), makeBar(2000, 101), makeBar(3000, 102)];
    const result = validateCandleBatch(bars);
    expect(result.valid).toHaveLength(3);
    expect(result.invalid).toHaveLength(0);
  });

  it("rejects a candle where high < low", () => {
    const bad = makeBar(1000, 100, { high: 50, low: 60 });
    const result = validateCandleBatch([bad]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reasons.join(" ")).toMatch(/high.*low/i);
  });

  it("rejects a candle where high < open or high < close", () => {
    const bad = makeBar(1000, 100, { high: 90, open: 95 });
    const result = validateCandleBatch([bad]);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects a candle where low > open or low > close", () => {
    const bad = makeBar(1000, 100, { low: 110 });
    const result = validateCandleBatch([bad]);
    expect(result.invalid).toHaveLength(1);
  });

  it("rejects non-positive or non-finite prices", () => {
    const zero = makeBar(1000, 100, { open: 0 });
    const negative = makeBar(2000, 100, { close: -5 });
    const nan = makeBar(3000, 100, { high: NaN });
    const result = validateCandleBatch([zero, negative, nan]);
    expect(result.invalid).toHaveLength(3);
  });

  it("rejects a negative volume but allows exactly zero", () => {
    const negativeVolume = makeBar(1000, 100, { volume: -1 });
    const zeroVolume = makeBar(2000, 100, { volume: 0 });
    const result = validateCandleBatch([negativeVolume, zeroVolume]);
    expect(result.invalid).toHaveLength(1);
    expect(result.valid).toHaveLength(1);
  });

  it("rejects an invalid timestamp", () => {
    const bad = makeBar(NaN, 100);
    const result = validateCandleBatch([bad]);
    expect(result.invalid).toHaveLength(1);
  });

  it("detects duplicate timestamps within the same batch", () => {
    const bars = [makeBar(1000, 100), makeBar(1000, 101)];
    const result = validateCandleBatch(bars);
    expect(result.duplicateTimestamps).toBeGreaterThan(0);
  });

  it("detects a chronology violation (out-of-order timestamps) within the same batch", () => {
    const bars = [makeBar(2000, 100), makeBar(1000, 101)];
    const result = validateCandleBatch(bars);
    expect(result.chronologyViolations).toBeGreaterThan(0);
  });
});
