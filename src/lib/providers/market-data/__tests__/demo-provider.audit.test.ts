import { describe, expect, it } from "vitest";
import { DemoMarketDataProvider } from "../demo-provider";

// AUDIT TEST — see technical audit report. Documents a confirmed data
// coherence bug in the demo market data generator: "the current price of
// BTC right now" is not a well-defined value in this implementation — it
// depends entirely on how many bars of history were requested alongside it,
// because the synthetic random walk is regenerated from scratch anchored
// `count` bars in the past on every single call, and then walked forward
// exactly `count` steps to reach "now". A request for 50 bars and a request
// for 200 bars each walk the identical seeded RNG stream from the same
// starting point, but for a different total number of compounding steps —
// so they arrive at a different "now" purely as an artifact of how much
// lookback was asked for, not because time actually passed differently.
//
// This corrupts anything that reads "the current price" from more than one
// call site with different limits/timeframes for the same symbol at
// virtually the same instant — e.g. a strategy scan computing indicators
// over N bars while a position tick calls getLatestPrice() separately.
const provider = new DemoMarketDataProvider();

describe("AUDIT: DemoMarketDataProvider price coherence", () => {
  it("the most recent bar's close should not depend on how many bars of history were requested", async () => {
    const short = await provider.getOHLCV("BTC", "M5", 50);
    const long = await provider.getOHLCV("BTC", "M5", 200);

    const shortLatest = short.bars[short.bars.length - 1];
    const longLatest = long.bars[long.bars.length - 1];

    // Both calls were made for the same symbol/timeframe at essentially the
    // same instant, so they should describe the same market state.
    expect(shortLatest.close).toBeCloseTo(longLatest.close, 0);
  });

  it("getLatestPrice() should agree with getOHLCV()'s most recent close for the same symbol", async () => {
    const latest = await provider.getLatestPrice("BTC");
    const ohlcv = await provider.getOHLCV("BTC", "M5", 100);
    const ohlcvLatest = ohlcv.bars[ohlcv.bars.length - 1];

    expect(latest).not.toBeNull();
    expect(latest!.price).toBeCloseTo(ohlcvLatest.close, 0);
  });

  it("bar index 0 (oldest requested bar) is identical regardless of how many bars were requested — proving the divergence above comes from walk-length-dependent compounding, not per-call randomness", async () => {
    const short = await provider.getOHLCV("BTC", "M5", 50);
    const long = await provider.getOHLCV("BTC", "M5", 200);
    expect(short.bars[0].close).toBeCloseTo(long.bars[0].close, 6);
  });
});
