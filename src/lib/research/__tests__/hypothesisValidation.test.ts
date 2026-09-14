import { describe, expect, it } from "vitest";
import {
  STABILITY_SCORE_FORMULA,
  WALK_FORWARD_LIMITATION_NOTE,
  SUPPLEMENTARY_WALK_FORWARD_OPTIONS,
  analyzeMarketEvent,
  buildHypothesisResult,
  classifyHypothesisStatus,
  compareGroups,
  computeIsValidationOosRanges,
  estimateCandleCount,
  isBearRegime,
  isHighVolatilityRegime,
  isRangeRegime,
  type HypothesisSegmentResult,
  type SegmentedTradeData,
} from "../hypothesisValidation";
import { attachRegimeToTrades, MIN_SAMPLE_SIZE } from "../regimeAnalysis";
import type { ReplayDecisionRecord, ReplayTradeRecord } from "@/lib/replay/types";
import type { Regime } from "@/lib/engines/regime";

function decision(overrides: Partial<ReplayDecisionRecord> = {}): ReplayDecisionRecord {
  return {
    timestamp: "2026-03-01T00:00:00.000Z",
    asset: "BTC",
    availability: { marketData: "REAL", news: "REAL", sentiment: "REAL", onChain: "REAL", ai: "DETERMINISTIC_SYNTHETIC" },
    regime: "RANGE",
    volatilityPercentile: 50,
    strategyId: "trend-following-baseline-v1",
    strategyName: "Trend Following Baseline",
    signal: { direction: "LONG", strength: 0.6, reason: "test" },
    aiAnalyst: null,
    aiCritic: null,
    tradeGateVerdict: "APPROVED",
    tradeGateBlockedBy: null,
    tradeGateSteps: null,
    riskPassed: true,
    riskViolations: null,
    evidenceLevel: null,
    decision: "OPENED",
    positionSize: 0.1,
    entryPrice: 100,
    reason: "test",
    ...overrides,
  };
}

function trade(overrides: Partial<ReplayTradeRecord> = {}): ReplayTradeRecord {
  return {
    asset: "BTC",
    strategyId: "trend-following-baseline-v1",
    strategyName: "Trend Following Baseline",
    direction: "LONG",
    entryTime: "2026-03-01T00:00:00.000Z",
    exitTime: "2026-03-01T04:00:00.000Z",
    entryPrice: 100,
    exitPrice: 103,
    quantity: 1,
    fees: 0.1,
    slippageCost: 0.05,
    grossPnl: 3,
    netPnl: 2.85,
    exitReason: "TAKE_PROFIT",
    mae: 0,
    mfe: 3,
    decisionIndex: 0,
    stopLoss: 98,
    takeProfit: 103,
    ...overrides,
  };
}

/** Builds N trades all sharing one regime, alternating win/loss around a target expectancy sign. */
function makeGroup(regime: Regime, count: number, netPnlFor: (i: number) => number, startTime = Date.parse("2026-03-01T00:00:00.000Z")): { trades: ReplayTradeRecord[]; decisions: ReplayDecisionRecord[] } {
  const decisions: ReplayDecisionRecord[] = [];
  const trades: ReplayTradeRecord[] = [];
  for (let i = 0; i < count; i++) {
    const entry = new Date(startTime + i * 4 * 3_600_000).toISOString();
    const exit = new Date(startTime + i * 4 * 3_600_000 + 3_600_000).toISOString();
    decisions.push(decision({ regime, timestamp: entry }));
    trades.push(trade({ entryTime: entry, exitTime: exit, decisionIndex: i, netPnl: netPnlFor(i), stopLoss: 95 }));
  }
  return { trades, decisions };
}

describe("computeIsValidationOosRanges: temporal ordering, no shuffle", () => {
  it("splits chronologically 60/20/20 with no gaps or overlaps", () => {
    const start = new Date("2026-03-01T00:00:00.000Z");
    const end = new Date("2026-08-31T23:00:00.000Z"); // 184 days
    const ranges = computeIsValidationOosRanges(start, end);
    expect(ranges).not.toBeNull();
    if (!ranges) return;

    expect(ranges.is.start.getTime()).toBe(start.getTime());
    expect(ranges.oos.end.getTime()).toBe(end.getTime());
    // strictly increasing, non-overlapping — the essence of "no mezclar datos entre segmentos"
    expect(ranges.is.start.getTime()).toBeLessThan(ranges.is.end.getTime());
    expect(ranges.is.end.getTime()).toBeLessThan(ranges.validation.start.getTime());
    expect(ranges.validation.start.getTime()).toBeLessThan(ranges.validation.end.getTime());
    expect(ranges.validation.end.getTime()).toBeLessThan(ranges.oos.start.getTime());
    expect(ranges.oos.start.getTime()).toBeLessThan(ranges.oos.end.getTime());
  });

  it("returns null (never fabricates segments) when the range is too short", () => {
    const start = new Date("2026-03-01T00:00:00.000Z");
    const end = new Date("2026-03-10T00:00:00.000Z"); // 9 days
    expect(computeIsValidationOosRanges(start, end)).toBeNull();
  });

  it("is deterministic — identical input produces byte-identical ranges", () => {
    const start = new Date("2026-03-01T00:00:00.000Z");
    const end = new Date("2026-08-31T23:00:00.000Z");
    const a = computeIsValidationOosRanges(start, end);
    const b = computeIsValidationOosRanges(start, end);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("estimateCandleCount", () => {
  it("counts H1 candles inclusively over a known range", () => {
    const range = { start: new Date("2026-03-01T00:00:00.000Z"), end: new Date("2026-03-01T10:00:00.000Z") };
    expect(estimateCandleCount(range)).toBe(11); // 0,1,...,10 = 11 hourly candles
  });
});

describe("compareGroups: no future leakage, correct attribution, insufficient sample", () => {
  it("splits trades into in-group/out-group purely from their OWN regime attribution", () => {
    const range1 = makeGroup("RANGE", 25, () => -5);
    const range2 = makeGroup("BULL", 25, () => 5, Date.parse("2026-04-01T00:00:00.000Z"));
    const trades = [...range1.trades, ...range2.trades].map((t, i) => ({ ...t, decisionIndex: i }));
    const decisions = [...range1.decisions, ...range2.decisions];

    const enriched = attachRegimeToTrades(trades, decisions);
    const cmp = compareGroups(enriched, isRangeRegime, "LOWER");

    expect(cmp.inGroup.trades).toBe(25);
    expect(cmp.outGroup.trades).toBe(25);
    expect(cmp.inGroup.insufficientSample).toBe(false);
    // RANGE (in-group) expectancy -5 < BULL (out-group) expectancy +5 -> direction LOWER holds
    expect(cmp.directionSupported).toBe(true);
  });

  it("marks directionSupported null when the in-group is below MIN_SAMPLE_SIZE — never coerces a verdict from a thin sample", () => {
    const thin = makeGroup("BEAR", 5, () => 10);
    const rest = makeGroup("RANGE", 25, () => -1, Date.parse("2026-04-01T00:00:00.000Z"));
    const trades = [...thin.trades, ...rest.trades].map((t, i) => ({ ...t, decisionIndex: i }));
    const decisions = [...thin.decisions, ...rest.decisions];

    const enriched = attachRegimeToTrades(trades, decisions);
    const cmp = compareGroups(enriched, isBearRegime, "HIGHER");

    expect(cmp.inGroup.trades).toBe(5);
    expect(cmp.inGroup.insufficientSample).toBe(true);
    expect(cmp.directionSupported).toBeNull();
  });

  it("boundary: exactly MIN_SAMPLE_SIZE trades in-group is evaluable", () => {
    const g = makeGroup("HIGH_VOLATILITY", MIN_SAMPLE_SIZE, () => 3);
    const rest = makeGroup("RANGE", MIN_SAMPLE_SIZE, () => -3, Date.parse("2026-05-01T00:00:00.000Z"));
    const trades = [...g.trades, ...rest.trades].map((t, i) => ({ ...t, decisionIndex: i }));
    const decisions = [...g.decisions, ...rest.decisions];
    const enriched = attachRegimeToTrades(trades, decisions);
    const cmp = compareGroups(enriched, isHighVolatilityRegime, "HIGHER");
    expect(cmp.inGroup.insufficientSample).toBe(false);
    expect(cmp.directionSupported).toBe(true);
  });
});

describe("classifyHypothesisStatus", () => {
  function seg(segment: "OOS" | "VALIDATION" | "IS", directionSupported: boolean | null): HypothesisSegmentResult {
    return {
      segment,
      range: { start: new Date(0), end: new Date(1) },
      candles: 1,
      comparison: {
        inGroup: { trades: 25, winRate: 0.5, totalPnl: 0, expectancy: 0, profitFactor: 1, avgTrade: 0, maxDrawdown: 0, longestLossStreak: 0, avgHoldingTimeHours: 0, insufficientSample: false },
        outGroup: { trades: 25, winRate: 0.5, totalPnl: 0, expectancy: 0, profitFactor: 1, avgTrade: 0, maxDrawdown: 0, longestLossStreak: 0, avgHoldingTimeHours: 0, insufficientSample: false },
        directionSupported,
      },
    };
  }

  it("SUPPORTED: every evaluable segment agrees, >=2 evaluable, OOS agrees", () => {
    const result = classifyHypothesisStatus([seg("OOS", true), seg("VALIDATION", true), seg("IS", true)]);
    expect(result.status).toBe("SUPPORTED");
    expect(result.stabilityScore).toBe(1);
    expect(result.evaluableSegments).toBe(3);
  });

  it("WEAK: only one evaluable segment even though it supports (cannot show consistency across segments)", () => {
    const result = classifyHypothesisStatus([seg("OOS", true), seg("VALIDATION", null), seg("IS", null)]);
    expect(result.status).toBe("WEAK");
    expect(result.evaluableSegments).toBe(1);
  });

  it("WEAK: mixed signal across evaluable segments", () => {
    const result = classifyHypothesisStatus([seg("OOS", true), seg("VALIDATION", false), seg("IS", true)]);
    expect(result.status).toBe("WEAK");
    expect(result.stabilityScore).toBeCloseTo(2 / 3);
  });

  it("WEAK (not SUPPORTED): OOS itself does not support even though others do", () => {
    const result = classifyHypothesisStatus([seg("OOS", false), seg("VALIDATION", true), seg("IS", true)]);
    expect(result.status).toBe("WEAK");
  });

  it("REJECTED: every evaluable segment contradicts the direction", () => {
    const result = classifyHypothesisStatus([seg("OOS", false), seg("VALIDATION", false), seg("IS", null)]);
    expect(result.status).toBe("REJECTED");
    expect(result.stabilityScore).toBe(0);
  });

  it("INCONCLUSIVE: no segment evaluable anywhere", () => {
    const result = classifyHypothesisStatus([seg("OOS", null), seg("VALIDATION", null), seg("IS", null)]);
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.stabilityScore).toBeNull();
  });
});

describe("buildHypothesisResult: OOS-first ordering, hypothesis attribution, determinism", () => {
  function threeSegments(): SegmentedTradeData[] {
    const oosGroup = makeGroup("RANGE", 25, () => -4, Date.parse("2026-08-01T00:00:00.000Z"));
    const oosRest = makeGroup("BULL", 25, () => 4, Date.parse("2026-08-05T00:00:00.000Z"));
    const valGroup = makeGroup("RANGE", 25, () => -3, Date.parse("2026-06-01T00:00:00.000Z"));
    const valRest = makeGroup("BULL", 25, () => 3, Date.parse("2026-06-05T00:00:00.000Z"));
    const isGroup = makeGroup("RANGE", 25, () => -6, Date.parse("2026-03-01T00:00:00.000Z"));
    const isRest = makeGroup("BULL", 25, () => 6, Date.parse("2026-03-05T00:00:00.000Z"));

    const withIdx = (arr: ReplayTradeRecord[]) => arr.map((t, i) => ({ ...t, decisionIndex: i }));
    return [
      { label: "IS", range: { start: new Date("2026-03-01"), end: new Date("2026-05-31") }, trades: withIdx([...isGroup.trades, ...isRest.trades]), decisions: [...isGroup.decisions, ...isRest.decisions] },
      { label: "VALIDATION", range: { start: new Date("2026-06-01"), end: new Date("2026-06-30") }, trades: withIdx([...valGroup.trades, ...valRest.trades]), decisions: [...valGroup.decisions, ...valRest.decisions] },
      { label: "OOS", range: { start: new Date("2026-08-01"), end: new Date("2026-08-31") }, trades: withIdx([...oosGroup.trades, ...oosRest.trades]), decisions: [...oosGroup.decisions, ...oosRest.decisions] },
    ];
  }

  it("orders segments OOS, VALIDATION, IS regardless of input order", () => {
    const result = buildHypothesisResult("H1_TEST", "RANGE unfavorable (test)", "trend-following-baseline-v1", "Trend Following", "LOWER", isRangeRegime, threeSegments());
    expect(result.segments.map((s) => s.segment)).toEqual(["OOS", "VALIDATION", "IS"]);
  });

  it("attributes the hypothesis to the requested strategy and finds SUPPORTED when the direction holds in every segment", () => {
    const result = buildHypothesisResult("H1_TEST", "RANGE unfavorable (test)", "trend-following-baseline-v1", "Trend Following", "LOWER", isRangeRegime, threeSegments());
    expect(result.strategyId).toBe("trend-following-baseline-v1");
    expect(result.status).toBe("SUPPORTED");
  });

  it("is deterministic — identical input produces byte-identical output", () => {
    const segments = threeSegments();
    const a = buildHypothesisResult("H1_TEST", "d", "s", "n", "LOWER", isRangeRegime, segments);
    const b = buildHypothesisResult("H1_TEST", "d", "s", "n", "LOWER", isRangeRegime, segments);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("throws rather than silently skipping a missing segment", () => {
    const segments = threeSegments().filter((s) => s.label !== "OOS");
    expect(() => buildHypothesisResult("H1_TEST", "d", "s", "n", "LOWER", isRangeRegime, segments)).toThrow();
  });
});

describe("analyzeMarketEvent: overlap detection, common vs strategy-specific classification", () => {
  const eventStart = new Date("2026-06-03T00:00:00.000Z");
  const eventEnd = new Date("2026-06-08T00:00:00.000Z");

  it("classifies COMMON_MARKET_EVENT when every strategy has an overlapping, losing trade", () => {
    const perStrategy = ["a", "b", "c", "d"].map((id) => ({
      strategyId: id,
      strategyName: id,
      trades: [trade({ entryTime: "2026-06-05T00:00:00.000Z", exitTime: "2026-06-05T04:00:00.000Z", netPnl: -10, decisionIndex: 0 })],
      decisions: [decision({ regime: "HIGH_VOLATILITY", timestamp: "2026-06-05T00:00:00.000Z" })],
    }));
    const result = analyzeMarketEvent(perStrategy, eventStart, eventEnd);
    expect(result.classification).toBe("COMMON_MARKET_EVENT");
    expect(result.status).toBe("SUPPORTED");
    expect(result.strategiesAffected).toBe(4);
  });

  it("classifies STRATEGY_SPECIFIC when only one strategy has an overlapping trade", () => {
    const perStrategy = [
      { strategyId: "a", strategyName: "a", trades: [trade({ entryTime: "2026-06-05T00:00:00.000Z", exitTime: "2026-06-05T04:00:00.000Z", netPnl: -10, decisionIndex: 0 })], decisions: [decision({ timestamp: "2026-06-05T00:00:00.000Z" })] },
      { strategyId: "b", strategyName: "b", trades: [trade({ entryTime: "2026-01-01T00:00:00.000Z", exitTime: "2026-01-01T04:00:00.000Z", netPnl: 5, decisionIndex: 0 })], decisions: [decision({ timestamp: "2026-01-01T00:00:00.000Z" })] },
    ];
    const result = analyzeMarketEvent(perStrategy, eventStart, eventEnd);
    expect(result.classification).toBe("STRATEGY_SPECIFIC");
    expect(result.status).toBe("REJECTED");
  });

  it("classifies NO_OVERLAP when nothing intersects the window", () => {
    const perStrategy = [{ strategyId: "a", strategyName: "a", trades: [trade({ entryTime: "2026-01-01T00:00:00.000Z", exitTime: "2026-01-01T04:00:00.000Z", decisionIndex: 0 })], decisions: [decision({ timestamp: "2026-01-01T00:00:00.000Z" })] }];
    const result = analyzeMarketEvent(perStrategy, eventStart, eventEnd);
    expect(result.classification).toBe("NO_OVERLAP");
    expect(result.status).toBe("INCONCLUSIVE");
  });

  it("includes a trade that opened just before the window and closed during it (interval overlap, not just entry-inside)", () => {
    const perStrategy = [
      {
        strategyId: "a",
        strategyName: "a",
        trades: [trade({ entryTime: "2026-06-02T20:00:00.000Z", exitTime: "2026-06-03T02:00:00.000Z", netPnl: -3, decisionIndex: 0 })],
        decisions: [decision({ timestamp: "2026-06-02T20:00:00.000Z" })],
      },
    ];
    const result = analyzeMarketEvent(perStrategy, eventStart, eventEnd);
    expect(result.byStrategy[0].tradesOverlapping).toBe(1);
  });

  it("is deterministic across two identical calls", () => {
    const perStrategy = [{ strategyId: "a", strategyName: "a", trades: [trade({ entryTime: "2026-06-05T00:00:00.000Z", exitTime: "2026-06-05T04:00:00.000Z", decisionIndex: 0 })], decisions: [decision({ timestamp: "2026-06-05T00:00:00.000Z" })] }];
    const a = analyzeMarketEvent(perStrategy, eventStart, eventEnd);
    const b = analyzeMarketEvent(perStrategy, eventStart, eventEnd);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("documented constants exist and are non-empty (spec sections 11/4 require documented formulas)", () => {
  it("STABILITY_SCORE_FORMULA and WALK_FORWARD_LIMITATION_NOTE are non-empty strings", () => {
    expect(STABILITY_SCORE_FORMULA.length).toBeGreaterThan(20);
    expect(WALK_FORWARD_LIMITATION_NOTE.length).toBeGreaterThan(20);
  });

  it("SUPPLEMENTARY_WALK_FORWARD_OPTIONS fits within the 184-day dataset for at least one window", () => {
    expect(SUPPLEMENTARY_WALK_FORWARD_OPTIONS.windowSizeDays).toBeLessThan(184);
  });
});
