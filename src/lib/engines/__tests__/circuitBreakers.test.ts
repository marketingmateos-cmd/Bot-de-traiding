import { describe, expect, it } from "vitest";
import { BREAKERS, type CircuitBreakerCheckContext } from "../circuitBreakers";

const healthyContext: CircuitBreakerCheckContext = {
  accountId: "acct",
  dailyPnlPct: 0.5,
  currentDrawdownPct: 2,
  tradesToday: 3,
  dataQualityScore: 95,
  apiHealthy: true,
  positionsConsistent: true,
};

function getBreaker(name: string) {
  const b = BREAKERS.find((x) => x.name === name);
  if (!b) throw new Error(`breaker ${name} not found`);
  return b;
}

describe("circuit breakers — pure evaluation logic", () => {
  it("does not trip any breaker under healthy conditions", () => {
    for (const breaker of BREAKERS) {
      expect(breaker.evaluate(healthyContext).tripped).toBe(false);
    }
  });

  it("trips max-daily-loss once daily P&L breaches the threshold", () => {
    const result = getBreaker("max-daily-loss").evaluate({ ...healthyContext, dailyPnlPct: -6 });
    expect(result.tripped).toBe(true);
  });

  it("does not trip max-daily-loss for a loss just under the threshold", () => {
    const result = getBreaker("max-daily-loss").evaluate({ ...healthyContext, dailyPnlPct: -4.9 });
    expect(result.tripped).toBe(false);
  });

  it("trips max-drawdown once drawdown breaches the threshold", () => {
    const result = getBreaker("max-drawdown").evaluate({ ...healthyContext, currentDrawdownPct: 25 });
    expect(result.tripped).toBe(true);
  });

  it("does NOT trip max-trades for a normal, high-frequency-but-controlled trading day (Fase 5 — trade count is no longer the primary firewall)", () => {
    // A strategy making many small, well-controlled trades must not be
    // treated the same as one making a few reckless ones — trade COUNT
    // alone is deliberately no longer enough to block trading.
    const result = getBreaker("max-trades").evaluate({ ...healthyContext, tradesToday: 100 });
    expect(result.tripped).toBe(false);
  });

  it("trips max-trades only as a technical safety ceiling against a runaway bug, far above any legitimate trading volume", () => {
    const result = getBreaker("max-trades").evaluate({ ...healthyContext, tradesToday: 300 });
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/límite técnico de seguridad/);
  });

  it("trips data-corruption when data quality drops below the floor", () => {
    const result = getBreaker("data-corruption").evaluate({ ...healthyContext, dataQualityScore: 40 });
    expect(result.tripped).toBe(true);
  });

  it("trips api-down when a data source is unhealthy", () => {
    const result = getBreaker("api-down").evaluate({ ...healthyContext, apiHealthy: false });
    expect(result.tripped).toBe(true);
  });

  it("trips position-inconsistency when reconciliation fails", () => {
    const result = getBreaker("position-inconsistency").evaluate({ ...healthyContext, positionsConsistent: false });
    expect(result.tripped).toBe(true);
  });
});
