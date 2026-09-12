import { describe, expect, it } from "vitest";
import { DemoMarketDataProvider } from "../demo-provider";

// AUDIT TEST — see technical audit report (Fase 1.A1). Originally documented
// a confirmed data coherence bug in the demo market data generator: "the
// current price of BTC right now" was not a well-defined value, because the
// synthetic random walk was regenerated from scratch anchored `count` bars
// in the past on every single call, and then walked forward exactly `count`
// steps to reach "now" — so a request for 50 bars and a request for 200 bars
// arrived at a different "now" purely as an artifact of how much lookback
// was asked for, not because time actually passed differently.
//
// FIXED: `generateSeries` now anchors the walk to a count-independent
// wall-clock bucket and always simulates a fixed-length canonical window
// internally, returning only a tail slice of it — so these tests now PASS,
// confirming the root cause (walk-length-dependent compounding) is gone.
// Kept in place (rather than deleted) as regression coverage for this exact
// bug class.
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

  it("bars that share the same absolute timestamp across a short and a long request are identical — proving the fix anchors the walk to wall-clock time, not to the requested count", async () => {
    // NOTE: prior to the Fase 1.A1 fix this test asserted `short.bars[0]`
    // equals `long.bars[0]` (bar INDEX 0 of each response). That assertion
    // only held because of the bug itself: the old generator always started
    // its RNG stream fresh at "index 0" regardless of `count`, so the first
    // bar drawn was coincidentally identical — it was never a real
    // correctness requirement, since index 0 of a 50-bar and a 200-bar
    // request necessarily describe different points in time (200 bars ago
    // vs. 50 bars ago) and have no reason to match. The fix below anchors
    // the walk to wall-clock time instead, so the real invariant is that
    // bars sharing the same TIMESTAMP (not the same array index) must agree
    // — exercised here on the 150 bars the two requests overlap on.
    const short = await provider.getOHLCV("BTC", "M5", 50);
    const long = await provider.getOHLCV("BTC", "M5", 200);

    const longByTimestamp = new Map(long.bars.map((b) => [b.timestamp.getTime(), b]));
    expect(short.bars.length).toBeGreaterThan(0);
    for (const bar of short.bars) {
      const match = longByTimestamp.get(bar.timestamp.getTime());
      expect(match).toBeDefined();
      expect(bar.close).toBeCloseTo(match!.close, 6);
    }
  });
});
