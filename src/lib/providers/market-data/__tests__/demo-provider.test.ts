import { describe, expect, it } from "vitest";
import { DemoMarketDataProvider } from "../demo-provider";

// Fase 1.A1 — dedicated coherence tests requested alongside the fix (the
// AUDIT tests in demo-provider.audit.test.ts encode the first two
// requirements and should now PASS given the same root-cause fix).
const provider = new DemoMarketDataProvider();

describe("DemoMarketDataProvider price coherence (Fase 1.A1 fix)", () => {
  it("repeating the same query within the same timestamp bucket produces an identical result", async () => {
    const first = await provider.getOHLCV("BTC", "M5", 100);
    const second = await provider.getOHLCV("BTC", "M5", 100);

    expect(second.bars.length).toBe(first.bars.length);
    for (let i = 0; i < first.bars.length; i++) {
      expect(second.bars[i].timestamp.getTime()).toBe(first.bars[i].timestamp.getTime());
      expect(second.bars[i].close).toBeCloseTo(first.bars[i].close, 10);
      expect(second.bars[i].open).toBeCloseTo(first.bars[i].open, 10);
      expect(second.bars[i].high).toBeCloseTo(first.bars[i].high, 10);
      expect(second.bars[i].low).toBeCloseTo(first.bars[i].low, 10);
    }
  });

  it("getOHLCV(50) and getOHLCV(200) agree on every bar they both cover, not just the latest one", async () => {
    const short = await provider.getOHLCV("ETH", "H1", 50);
    const long = await provider.getOHLCV("ETH", "H1", 200);

    // The last 50 bars of the 200-bar series should exactly match the 50-bar
    // series bar-for-bar (same canonical walk, different tail slices).
    const longTail = long.bars.slice(long.bars.length - 50);
    for (let i = 0; i < 50; i++) {
      expect(longTail[i].timestamp.getTime()).toBe(short.bars[i].timestamp.getTime());
      expect(longTail[i].close).toBeCloseTo(short.bars[i].close, 10);
    }
  });

  it("getLatestPrice() timestamp matches the last bar's timestamp from getOHLCV()", async () => {
    const latest = await provider.getLatestPrice("SOL");
    const ohlcv = await provider.getOHLCV("SOL", "M5", 100);
    const ohlcvLatest = ohlcv.bars[ohlcv.bars.length - 1];

    expect(latest).not.toBeNull();
    expect(latest!.timestamp.getTime()).toBe(ohlcvLatest.timestamp.getTime());
    expect(latest!.price).toBeCloseTo(ohlcvLatest.close, 10);
  });

  it("different symbols are independent (no cross-contamination from the shared canonical-length constant)", async () => {
    const btc = await provider.getOHLCV("BTC", "M5", 20);
    const eth = await provider.getOHLCV("ETH", "M5", 20);
    expect(btc.bars[btc.bars.length - 1].close).not.toBeCloseTo(eth.bars[eth.bars.length - 1].close, 0);
  });
});
