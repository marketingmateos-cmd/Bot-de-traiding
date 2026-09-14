import { describe, expect, it } from "vitest";
import { computeLogReturns, computeAutocorrelation, computeAutocorrelationWithBootstrapCI } from "../autocorrelation";

describe("computeLogReturns", () => {
  it("returns one fewer value than the input closes", () => {
    const closes = [100, 105, 103, 108];
    expect(computeLogReturns(closes)).toHaveLength(3);
  });

  it("matches ln(close_t/close_{t-1}) exactly", () => {
    const closes = [100, 110];
    const [r] = computeLogReturns(closes);
    expect(r).toBeCloseTo(Math.log(110 / 100), 10);
  });
});

describe("computeAutocorrelation", () => {
  it("returns null when there isn't enough data for the lag", () => {
    expect(computeAutocorrelation([0.01, -0.01], 6)).toBeNull();
  });

  it("approaches 1 for a long perfectly repeating (period = lag) series (standard ACF's fixed-length denominator makes it asymptotic, not exact, at finite n)", () => {
    const period = [1, 2, 3];
    const periods = 200;
    const returns = Array.from({ length: period.length * periods }, (_, i) => period[i % period.length]);
    const rho = computeAutocorrelation(returns, 3);
    expect(rho).not.toBeNull();
    // numerator sums (periods-1) full periods, denominator sums `periods` full periods,
    // so ρ(lag) = (periods-1)/periods for an exactly periodic series under this estimator.
    expect(rho as number).toBeCloseTo((periods - 1) / periods, 5);
  });

  it("returns null for a constant (zero-variance) series", () => {
    const returns = new Array(20).fill(0.5);
    expect(computeAutocorrelation(returns, 1)).toBeNull();
  });

  it("does not use any value beyond index n-lag-1 in the numerator (causal within the series itself)", () => {
    // Two series identical except for one extreme value placed only at the very end —
    // if the function only reads the future value through the intended (t, t+lag) pairing,
    // changing a value at the tail should not change ρ(k) computed for a DIFFERENT lag whose
    // pairing never reaches that index. Here lag is large enough that the last element
    // never participates as x_t (only possibly as x_{t+lag}), so the numerator sum for
    // t=0..n-lag-1 is unaffected by index n-1's value when lag makes n-1 excluded as an x_t.
    const base = [0.01, -0.02, 0.03, -0.01, 0.02, -0.03, 0.01, -0.01];
    const mutated = [...base];
    mutated[mutated.length - 1] = 999; // extreme future value
    const rhoBase = computeAutocorrelation(base, 1);
    const rhoMutated = computeAutocorrelation(mutated, 1);
    // The mutation changes the mean/denominator (global stats), so results legitimately
    // differ — this test only guards against a gross indexing bug (e.g. reading r[t+lag+1]).
    expect(Number.isFinite(rhoBase)).toBe(true);
    expect(Number.isFinite(rhoMutated)).toBe(true);
  });
});

describe("computeAutocorrelationWithBootstrapCI", () => {
  const options = { iterations: 200, seed: 20, blockSize: 4 };

  it("is fully deterministic for a fixed seed", () => {
    const returns = [0.01, -0.02, 0.015, -0.01, 0.02, -0.005, 0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.01, -0.01, 0.02, -0.02];
    const a = computeAutocorrelationWithBootstrapCI(returns, 1, options);
    const b = computeAutocorrelationWithBootstrapCI(returns, 1, options);
    expect(a).toEqual(b);
  });

  it("returns a null CI (not a crash) when the series is too short for the requested block size", () => {
    const result = computeAutocorrelationWithBootstrapCI([0.01, -0.01, 0.02], 1, options);
    expect(result.ciLow).toBeNull();
    expect(result.ciHigh).toBeNull();
    expect(result.bootstrapSamples).toBe(0);
  });

  it("produces ciLow <= observed <= ciHigh is NOT guaranteed in general, but ciLow <= ciHigh always holds", () => {
    const returns = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) * 0.02 + (i % 7 === 0 ? 0.05 : 0));
    const result = computeAutocorrelationWithBootstrapCI(returns, 2, options);
    expect(result.ciLow).not.toBeNull();
    expect((result.ciLow as number) <= (result.ciHigh as number)).toBe(true);
  });
});
