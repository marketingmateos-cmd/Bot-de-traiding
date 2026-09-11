import { describe, expect, it } from "vitest";
import { checkStopsAndTargets, simulateFill } from "../paperExecution";

describe("simulateFill", () => {
  it("is deterministic for the same idempotency key", () => {
    const req = { direction: "LONG" as const, requestedPrice: 100, quantity: 1, feeBps: 10, slippageBps: 5, idempotencyKey: "order-1" };
    const a = simulateFill(req);
    const b = simulateFill(req);
    expect(a).toEqual(b);
  });

  it("produces different fills for different idempotency keys", () => {
    const base = { direction: "LONG" as const, requestedPrice: 100, quantity: 1, feeBps: 10, slippageBps: 5 };
    const a = simulateFill({ ...base, idempotencyKey: "order-1" });
    const b = simulateFill({ ...base, idempotencyKey: "order-2" });
    expect(a.fillPrice).not.toBe(b.fillPrice);
  });

  it("applies adverse slippage in the direction of the trade (LONG fills at or above requested price)", () => {
    const fill = simulateFill({ direction: "LONG", requestedPrice: 100, quantity: 1, feeBps: 10, slippageBps: 5, idempotencyKey: "long-1" });
    expect(fill.fillPrice).toBeGreaterThanOrEqual(100);
  });

  it("applies adverse slippage in the direction of the trade (SHORT fills at or below requested price)", () => {
    const fill = simulateFill({ direction: "SHORT", requestedPrice: 100, quantity: 1, feeBps: 10, slippageBps: 5, idempotencyKey: "short-1" });
    expect(fill.fillPrice).toBeLessThanOrEqual(100);
  });

  it("computes fee proportional to notional and feeBps", () => {
    const fill = simulateFill({ direction: "LONG", requestedPrice: 100, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "fee-check" });
    const notional = fill.fillPrice * fill.filledQuantity;
    expect(fill.fee).toBeCloseTo(notional * 0.001, 6);
  });

  it("never fills more than the requested quantity", () => {
    for (let i = 0; i < 50; i++) {
      const fill = simulateFill({ direction: "LONG", requestedPrice: 100, quantity: 5, feeBps: 10, slippageBps: 5, idempotencyKey: `qty-${i}` });
      expect(fill.filledQuantity).toBeLessThanOrEqual(5);
      expect(fill.filledQuantity + fill.remainingQuantity).toBeCloseTo(5, 6);
    }
  });
});

describe("checkStopsAndTargets", () => {
  it("triggers a LONG stop loss when the bar's low touches the stop", () => {
    const result = checkStopsAndTargets({
      direction: "LONG",
      entryPrice: 100,
      currentHigh: 101,
      currentLow: 94,
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      highestSinceEntry: 101,
      lowestSinceEntry: 94,
    });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("STOP_LOSS");
    expect(result.exitPrice).toBe(95);
  });

  it("triggers a LONG take profit when the bar's high reaches the target", () => {
    const result = checkStopsAndTargets({
      direction: "LONG",
      entryPrice: 100,
      currentHigh: 111,
      currentLow: 99,
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      highestSinceEntry: 111,
      lowestSinceEntry: 99,
    });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("TAKE_PROFIT");
  });

  it("does not trigger when price stays inside the stop/target band", () => {
    const result = checkStopsAndTargets({
      direction: "LONG",
      entryPrice: 100,
      currentHigh: 103,
      currentLow: 98,
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      highestSinceEntry: 103,
      lowestSinceEntry: 98,
    });
    expect(result.triggered).toBe(false);
  });

  it("mirrors LONG logic for SHORT positions", () => {
    const stopHit = checkStopsAndTargets({
      direction: "SHORT",
      entryPrice: 100,
      currentHigh: 106,
      currentLow: 99,
      stopLoss: 105,
      takeProfit: 90,
      trailingStopPct: null,
      highestSinceEntry: 106,
      lowestSinceEntry: 99,
    });
    expect(stopHit.triggered).toBe(true);
    expect(stopHit.reason).toBe("STOP_LOSS");
  });

  it("tightens a LONG stop upward as price advances when a trailing stop is set", () => {
    // Entry 100, trailing 5%. Price ran up to 120, so trailing stop should be 120*0.95=114,
    // which is tighter (higher) than the static stop of 90 and should now be the effective stop.
    const result = checkStopsAndTargets({
      direction: "LONG",
      entryPrice: 100,
      currentHigh: 120,
      currentLow: 113,
      stopLoss: 90,
      takeProfit: null,
      trailingStopPct: 5,
      highestSinceEntry: 120,
      lowestSinceEntry: 100,
    });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("TRAILING_STOP");
    expect(result.exitPrice).toBeCloseTo(114, 6);
  });
});
