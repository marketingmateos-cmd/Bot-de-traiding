import { describe, expect, it } from "vitest";
import { sma, ema, rsi, zScore } from "../features";

describe("sma", () => {
  it("computes a simple moving average correctly and leaves warmup as null", () => {
    const values = [1, 2, 3, 4, 5, 6];
    const result = sma(values, 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2, 6); // avg(1,2,3)
    expect(result[5]).toBeCloseTo(5, 6); // avg(4,5,6)
  });
});

describe("ema", () => {
  it("seeds from an SMA and then decays toward new values", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = ema(values, 3);
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2, 6); // seed = avg(1,2,3)
    expect(result[7]).not.toBeNull();
  });
});

describe("rsi", () => {
  it("returns 100 for a strictly increasing series (no losses)", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = rsi(values, 14);
    expect(result[14]).toBe(100);
  });

  it("returns a low value for a strictly decreasing series", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 - i);
    const result = rsi(values, 14);
    expect(result[14]).toBeLessThan(10);
  });

  it("returns null before enough warmup data exists", () => {
    const result = rsi([1, 2, 3], 14);
    expect(result.every((v) => v === null)).toBe(true);
  });
});

describe("zScore", () => {
  it("returns 0 for a constant series (zero variance)", () => {
    const values = new Array(25).fill(5);
    const result = zScore(values, 20);
    expect(result[24]).toBe(0);
  });

  it("returns a large positive value for an outlier spike", () => {
    const values = new Array(20).fill(10).concat([1000]);
    const result = zScore(values, 20);
    expect(result[20]).toBeGreaterThan(3);
  });
});
