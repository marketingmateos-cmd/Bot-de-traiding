import { describe, expect, it } from "vitest";
import { computeStrategyConfigHash } from "../configHash";

describe("Fase 11 — computeStrategyConfigHash: reproducibility", () => {
  it("the same strategy id/version/params always produces the same hash", () => {
    const h1 = computeStrategyConfigHash("breakout-baseline-v1", "1.0", { lookback: 20, atrMultiplier: 1.5 });
    const h2 = computeStrategyConfigHash("breakout-baseline-v1", "1.0", { lookback: 20, atrMultiplier: 1.5 });
    expect(h1).toBe(h2);
  });

  it("key insertion order never changes the hash", () => {
    const h1 = computeStrategyConfigHash("breakout-baseline-v1", "1.0", { lookback: 20, atrMultiplier: 1.5 });
    const h2 = computeStrategyConfigHash("breakout-baseline-v1", "1.0", { atrMultiplier: 1.5, lookback: 20 });
    expect(h1).toBe(h2);
  });

  it("a different parameter value changes the hash", () => {
    const h1 = computeStrategyConfigHash("breakout-baseline-v1", "1.0", { lookback: 20 });
    const h2 = computeStrategyConfigHash("breakout-baseline-v1", "1.0", { lookback: 21 });
    expect(h1).not.toBe(h2);
  });

  it("a different strategy id changes the hash even with identical params", () => {
    const h1 = computeStrategyConfigHash("breakout-baseline-v1", "1.0", { lookback: 20 });
    const h2 = computeStrategyConfigHash("momentum-baseline-v1", "1.0", { lookback: 20 });
    expect(h1).not.toBe(h2);
  });
});
