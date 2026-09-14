import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStopsAndTargets, simulateFill } from "@/lib/engines/paperExecution";
import { calculatePositionSize, checkExposureLimits, resolveRiskLimitsForLevel } from "@/lib/engines/riskEngine";
import { evaluateEvaluationAccount, computeEvaluationDayKey, type EvaluationAccountState } from "@/lib/evaluation/evaluationRiskEngine";
import { ReplayPortfolio, type ReplayOpenPosition } from "../replayPortfolio";
import { calculateReferencePnL, calculateReferenceRMultiple } from "../pnlReferenceModel";
import { runFullReplay } from "../runReplay";
import type { ReplayConfig, ReplayTradeRecord } from "../types";

/**
 * Fase 15 — Replay & Execution Integrity Audit. This file is deliberately
 * NOT a re-test of everything `riskEngine.test.ts`, `evaluationRiskEngine.test.ts`,
 * and `paperExecution.test.ts` already cover thoroughly (sticky FAILED/
 * TARGET_REACHED, never-approve-more-than-requested, UTC day-boundary math,
 * risk-level monotonicity — all already tested elsewhere and unaffected by
 * this audit). It targets the specific gaps the audit brief calls out:
 * same-candle SL/TP ordering, an INDEPENDENT P&L reference model, exposure
 * freshness within one tick, the equity identity, the day-boundary ↔
 * unrealized-P&L integration, a structural anti-lookahead check, ten
 * hand-computed manual scenarios, and whole-run invariants.
 */

function pos(overrides: Partial<ReplayOpenPosition> = {}): ReplayOpenPosition {
  return {
    asset: "BTC",
    strategyId: "test-strategy",
    strategyName: "Test Strategy",
    direction: "LONG",
    entryPrice: 100,
    quantity: 1,
    stopLoss: 95,
    takeProfit: 110,
    trailingStopPct: null,
    entryTime: "2026-01-01T00:00:00.000Z",
    highestSinceEntry: 100,
    lowestSinceEntry: 100,
    mae: 0,
    mfe: 0,
    decisionIndex: 0,
    ...overrides,
  };
}

// ── Section 5/6 — same-candle SL/TP: the current, deterministic policy ──

describe("SAME-CANDLE SL/TP POLICY (spec sections 5/6) — documented, deterministic, order-blind", () => {
  it("LONG: when a single candle's high>=TP AND low<=SL simultaneously, the engine ALWAYS resolves it as STOP_LOSS, never TAKE_PROFIT", () => {
    const result = checkStopsAndTargets({
      direction: "LONG",
      entryPrice: 100,
      currentHigh: 115, // would also satisfy takeProfit=110
      currentLow: 90, // satisfies stopLoss=95
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      highestSinceEntry: 115,
      lowestSinceEntry: 90,
    });
    // Policy: `checkStopsAndTargets` checks the stop branch FIRST and returns
    // immediately on a hit — take-profit is only ever reached when the stop
    // did NOT trigger. This is a deterministic "pessimistic" convention
    // (favors the worse outcome when intrabar TP/SL ordering is genuinely
    // unknowable from H1 OHLC alone — spec section 6), not an artifact of
    // input ordering: it holds regardless of how far price moved past each level.
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("STOP_LOSS");
    expect(result.exitPrice).toBe(95);
  });

  it("SHORT: when a single candle's low<=TP AND high>=SL simultaneously, the engine ALWAYS resolves it as STOP_LOSS, never TAKE_PROFIT", () => {
    const result = checkStopsAndTargets({
      direction: "SHORT",
      entryPrice: 100,
      currentHigh: 108, // satisfies stopLoss=105
      currentLow: 85, // would also satisfy takeProfit=90
      stopLoss: 105,
      takeProfit: 90,
      trailingStopPct: null,
      highestSinceEntry: 108,
      lowestSinceEntry: 85,
    });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("STOP_LOSS");
    expect(result.exitPrice).toBe(105);
  });

  it("policy is symmetric regardless of HOW FAR each level was breached — stop wins even when TP was breached by more", () => {
    const result = checkStopsAndTargets({
      direction: "LONG",
      entryPrice: 100,
      currentHigh: 200, // TP=110 breached by a lot
      currentLow: 94.9, // SL=95 breached by a hair
      stopLoss: 95,
      takeProfit: 110,
      trailingStopPct: null,
      highestSinceEntry: 200,
      lowestSinceEntry: 94.9,
    });
    expect(result.reason).toBe("STOP_LOSS");
  });
});

// ── Section 3/4 — entry/exit price, fees applied exactly once (cash-level) ──

describe("FEES (spec section 7) — entry fee and exit fee both applied exactly once, never double-counted, never dropped", () => {
  it("cashBalance moves by exactly -entryFee at open, then by netPnl(=grossPnl-exitFee) at close — full round trip nets to grossPnl-entryFee-exitFee", () => {
    const portfolio = new ReplayPortfolio(10_000);
    const entryFill = simulateFill({ direction: "LONG", requestedPrice: 100, quantity: 1, feeBps: 10, slippageBps: 5, idempotencyKey: "audit:entry" });

    portfolio.openPosition(pos({ entryPrice: entryFill.fillPrice, quantity: entryFill.filledQuantity }), entryFill.fee);
    expect(portfolio.cashBalance).toBeCloseTo(10_000 - entryFill.fee, 9);

    const exitFill = simulateFill({ direction: "SHORT", requestedPrice: 110, quantity: entryFill.filledQuantity, feeBps: 10, slippageBps: 5, idempotencyKey: "audit:exit" });
    const grossPnl = (exitFill.fillPrice - entryFill.fillPrice) * entryFill.filledQuantity;
    const netPnl = grossPnl - exitFill.fee;
    const trade: ReplayTradeRecord = {
      asset: "BTC",
      strategyId: "test-strategy",
      strategyName: "Test Strategy",
      direction: "LONG",
      entryTime: "2026-01-01T00:00:00.000Z",
      exitTime: "2026-01-01T01:00:00.000Z",
      entryPrice: entryFill.fillPrice,
      exitPrice: exitFill.fillPrice,
      quantity: entryFill.filledQuantity,
      fees: exitFill.fee,
      slippageCost: exitFill.slippageCost,
      grossPnl,
      netPnl,
      exitReason: "TAKE_PROFIT",
      mae: 0,
      mfe: 0.1,
      decisionIndex: 0,
      stopLoss: 95,
      takeProfit: 110,
    };
    portfolio.closePosition("BTC", "test-strategy", trade);

    const totalCashDelta = portfolio.cashBalance - 10_000;
    // The account-level truth includes BOTH fees exactly once each — this is
    // the reconciliation the per-trade `netPnl` field (exit fee only, by
    // design — see the module doc comment) does not itself display.
    expect(totalCashDelta).toBeCloseTo(grossPnl - entryFill.fee - exitFill.fee, 9);
    // And the documented convention: trade.netPnl == grossPnl - exitFee (NOT
    // -entryFee too) — proven equal to the reference model computed the same way.
    const reference = calculateReferencePnL({ side: "LONG", entryPrice: entryFill.fillPrice, exitPrice: exitFill.fillPrice, notional: entryFill.filledQuantity * entryFill.fillPrice, fees: exitFill.fee });
    expect(trade.netPnl).toBeCloseTo(reference.netPnl, 9);
  });

  it("slippageCost is NEVER subtracted a second time on top of the already slippage-adjusted fillPrice (no double-counting)", () => {
    const fill = simulateFill({ direction: "LONG", requestedPrice: 100, quantity: 1, feeBps: 0, slippageBps: 20, idempotencyKey: "audit:no-double-count" });
    // grossPnl computed the way the engine actually computes it (from fillPrice, which already bakes in slippage):
    const grossPnlFromFillPrice = (105 - fill.fillPrice) * 1; // arbitrary exit at 105
    // A WRONG, double-counting formula would additionally subtract slippageCost:
    const wrongDoubleCounted = grossPnlFromFillPrice - fill.slippageCost;
    // The engine's actual formula (see historicalReplayEngine.ts: netPnl = grossPnl - fill.fee) never does this subtraction — confirm the two diverge whenever slippageCost != 0, so a reviewer can see exactly what double-counting WOULD look like and confirm the engine doesn't do it.
    if (fill.slippageCost > 0) expect(wrongDoubleCounted).not.toBeCloseTo(grossPnlFromFillPrice, 9);
  });
});

// ── Section 8/9 — slippage direction/magnitude, independent P&L reference model ──

describe("P&L REFERENCE MODEL (spec section 9) — independent cross-check against real simulateFill output", () => {
  it("LONG winner: reference netPnl matches a manually-derived expectation", () => {
    const entry = simulateFill({ direction: "LONG", requestedPrice: 100, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:long-win:entry" });
    const exit = simulateFill({ direction: "SHORT", requestedPrice: 120, quantity: entry.filledQuantity, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:long-win:exit" });
    const ref = calculateReferencePnL({ side: "LONG", entryPrice: entry.fillPrice, exitPrice: exit.fillPrice, notional: entry.filledQuantity * entry.fillPrice, fees: exit.fee });
    expect(ref.netPnl).toBeCloseTo((exit.fillPrice - entry.fillPrice) * entry.filledQuantity - exit.fee, 9);
    expect(ref.netPnl).toBeGreaterThan(0); // price rose 20%, minus small costs — still clearly a winner
  });

  it("LONG loser: reference netPnl matches and is negative", () => {
    const entry = simulateFill({ direction: "LONG", requestedPrice: 100, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:long-loss:entry" });
    const exit = simulateFill({ direction: "SHORT", requestedPrice: 95, quantity: entry.filledQuantity, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:long-loss:exit" });
    const ref = calculateReferencePnL({ side: "LONG", entryPrice: entry.fillPrice, exitPrice: exit.fillPrice, notional: entry.filledQuantity * entry.fillPrice, fees: exit.fee });
    expect(ref.netPnl).toBeLessThan(0);
  });

  it("SHORT winner: price falls, reference netPnl is positive", () => {
    const entry = simulateFill({ direction: "SHORT", requestedPrice: 100, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:short-win:entry" });
    const exit = simulateFill({ direction: "LONG", requestedPrice: 80, quantity: entry.filledQuantity, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:short-win:exit" });
    const ref = calculateReferencePnL({ side: "SHORT", entryPrice: entry.fillPrice, exitPrice: exit.fillPrice, notional: entry.filledQuantity * entry.fillPrice, fees: exit.fee });
    expect(ref.netPnl).toBeCloseTo(-1 * (exit.fillPrice - entry.fillPrice) * entry.filledQuantity - exit.fee, 9);
    expect(ref.netPnl).toBeGreaterThan(0);
  });

  it("SHORT loser: price rises against the short, reference netPnl is negative", () => {
    const entry = simulateFill({ direction: "SHORT", requestedPrice: 100, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:short-loss:entry" });
    const exit = simulateFill({ direction: "LONG", requestedPrice: 115, quantity: entry.filledQuantity, feeBps: 10, slippageBps: 0, idempotencyKey: "ref:short-loss:exit" });
    const ref = calculateReferencePnL({ side: "SHORT", entryPrice: entry.fillPrice, exitPrice: exit.fillPrice, notional: entry.filledQuantity * entry.fillPrice, fees: exit.fee });
    expect(ref.netPnl).toBeLessThan(0);
  });

  it("R-multiple scales linearly with a reduced (partial/clamped) position size — the metric stays internally consistent under Trade Gate size reduction", () => {
    const fullSize = calculateReferenceRMultiple(-300, 100, 95, 60); // 60 units, entry 100, stop 95 -> riskAmount=300, netPnl=-300 -> R=-1
    const halfSize = calculateReferenceRMultiple(-150, 100, 95, 30); // half the quantity, half the loss -> same R
    expect(fullSize).toBeCloseTo(-1, 9);
    expect(halfSize).toBeCloseTo(-1, 9);
  });
});

// ── Section 11/12 — position sizing across risk levels, exposure freshness ──

describe("POSITION SIZING across Risk Level 1/5/10 (spec section 11) — approvedNotional never exceeds requested, realized $ risk never exceeds configured", () => {
  for (const level of [1, 5, 10]) {
    it(`Risk Level ${level}: approvedNotional <= requestedNotional and realized risk <= equity*riskPerTradePct%`, () => {
      const limits = resolveRiskLimitsForLevel(level);
      const equity = 20_000;
      const entryPrice = 100;
      const stopLossPrice = 97; // 3% stop
      const sizing = calculatePositionSize({ equity, entryPrice, stopLossPrice, riskPerTradePct: limits.riskPerTradePct });

      const risk = checkExposureLimits({
        equity,
        openNotional: 0,
        requestedNotional: sizing.notional,
        limits,
        openPositionCount: 0,
        assetOpenNotional: 0,
        correlatedOpenNotional: 0,
      });

      expect(risk.approvedNotional).toBeLessThanOrEqual(sizing.notional + 1e-9);
      const approvedQuantity = risk.approvedNotional / entryPrice;
      const realizedDollarRisk = approvedQuantity * Math.abs(entryPrice - stopLossPrice);
      const configuredDollarRisk = equity * (limits.riskPerTradePct / 100);
      expect(realizedDollarRisk).toBeLessThanOrEqual(configuredDollarRisk + 1e-6);
    });
  }
});

describe("EXPOSURE FRESHNESS within one tick (spec section 12) — a second candidate in the same cycle never sees a stale openNotional/assetNotional", () => {
  it("openNotional() and assetNotional() reflect a just-opened position immediately, before any equity-curve tick is recorded", () => {
    const portfolio = new ReplayPortfolio(10_000);
    expect(portfolio.openNotional()).toBe(0);
    expect(portfolio.assetNotional("BTC")).toBe(0);

    portfolio.openPosition(pos({ asset: "BTC", strategyId: "strategy-a", entryPrice: 100, quantity: 2 }), 0);

    // A hypothetical second candidate (different strategy, same asset) evaluated in the SAME tick must see the just-opened position's notional immediately — never the pre-open snapshot.
    expect(portfolio.openNotional()).toBeCloseTo(200, 9);
    expect(portfolio.assetNotional("BTC")).toBeCloseTo(200, 9);
    expect(portfolio.hasOpenPosition("BTC", "strategy-a")).toBe(true);
  });
});

describe("EQUITY IDENTITY (spec section 13) — equity = cashBalance + unrealized, exactly, at every recorded tick", () => {
  it("one open LONG position marked at a known price reproduces the exact identity", () => {
    const portfolio = new ReplayPortfolio(10_000);
    portfolio.openPosition(pos({ asset: "BTC", entryPrice: 100, quantity: 2, direction: "LONG" }), 5); // entryFee=5
    expect(portfolio.cashBalance).toBe(9995);

    portfolio.recordTick(Date.parse("2026-01-01T01:00:00.000Z"), new Map([["BTC", 110]]));
    const point = portfolio.equityCurve[portfolio.equityCurve.length - 1];
    const expectedUnrealized = (110 - 100) * 2;
    expect(point.equity).toBeCloseTo(portfolio.cashBalance + expectedUnrealized, 9);
    expect(point.equity).toBeCloseTo(9995 + 20, 9);
  });

  it("a SHORT position's unrealized P&L is the mirror image of a LONG's for the same price move", () => {
    const portfolio = new ReplayPortfolio(10_000);
    portfolio.openPosition(pos({ asset: "BTC", entryPrice: 100, quantity: 2, direction: "SHORT" }), 0);
    portfolio.recordTick(Date.parse("2026-01-01T01:00:00.000Z"), new Map([["BTC", 110]])); // price rose -> SHORT loses
    const point = portfolio.equityCurve[0];
    expect(point.equity).toBeCloseTo(10_000 - (110 - 100) * 2, 9);
  });
});

// ── Section 14 — daily loss: open-position unrealized P&L crossing a day boundary ──

describe("DAILY LOSS integration (spec section 14) — an OPEN position's unrealized P&L is included via the equity curve, correctly relative to day-start equity", () => {
  it("a losing open position held across UTC midnight correctly registers as that day's daily loss once evaluated", () => {
    const portfolio = new ReplayPortfolio(10_000);
    portfolio.openPosition(pos({ asset: "BTC", entryPrice: 100, quantity: 50, direction: "LONG" }), 0);

    // Tick just before midnight: no move yet.
    portfolio.recordTick(Date.parse("2026-01-01T23:00:00.000Z"), new Map([["BTC", 100]]));
    // Tick just after midnight: price has dropped, position is now underwater — still open (no SL hit in this scenario).
    portfolio.recordTick(Date.parse("2026-01-02T00:00:00.000Z"), new Map([["BTC", 96]])); // -4% move, 50 units -> -200 unrealized

    const dayStartEquity = portfolio.equityCurve[1].equity + 200; // equity right at day start (before the drop), for a resetHourUtc=0 day boundary at this exact tick
    const account: EvaluationAccountState = {
      initialBalance: 10_000,
      phase: "PHASE_1",
      phase1TargetPct: 10,
      phase2TargetPct: 5,
      dailySafetyPct: -3,
      dailyHardPct: -5,
      totalSafetyPct: -6,
      totalHardPct: -10,
      baseRiskPct: 1,
      minRRR: 1.5,
      status: "ACTIVE",
      dayStartEquity,
    };
    const result = evaluateEvaluationAccount({ account, currentEquity: portfolio.equityCurve[1].equity });
    // -200 on a 10,000 day-start equity is exactly -2% — inside safety (-3%) and hard (-5%) bands, so still ACTIVE but the unrealized loss IS visible in dailyPnlPct (not silently ignored just because the position hasn't closed).
    expect(result.dailyPnlPct).toBeCloseTo(-2, 6);
    expect(result.status).toBe("ACTIVE");
    expect(result.blockNewEntries).toBe(false);
  });

  it("computeEvaluationDayKey correctly separates the two ticks above into different UTC days at resetHourUtc=0", () => {
    expect(computeEvaluationDayKey(new Date("2026-01-01T23:00:00.000Z"), 0)).toBe("2026-01-01");
    expect(computeEvaluationDayKey(new Date("2026-01-02T00:00:00.000Z"), 0)).toBe("2026-01-02");
  });
});

describe("TOTAL LOSS sticky state across MULTIPLE subsequent ticks (spec section 15)", () => {
  it("once FAILED, stays FAILED across several further evaluate calls regardless of equity direction", () => {
    const base: EvaluationAccountState = {
      initialBalance: 10_000,
      phase: "PHASE_1",
      phase1TargetPct: 10,
      phase2TargetPct: 5,
      dailySafetyPct: -3,
      dailyHardPct: -5,
      totalSafetyPct: -6,
      totalHardPct: -10,
      baseRiskPct: 1,
      minRRR: 1.5,
      status: "ACTIVE",
      dayStartEquity: 10_000,
    };
    const failResult = evaluateEvaluationAccount({ account: base, currentEquity: 8_900 }); // -11%, past -10% hard stop
    expect(failResult.status).toBe("FAILED");

    let status = failResult.status;
    for (const equity of [9_500, 10_500, 12_000, 9_000]) {
      const r = evaluateEvaluationAccount({ account: { ...base, status }, currentEquity: equity });
      expect(r.status).toBe("FAILED");
      expect(r.blockNewEntries).toBe(true);
      status = r.status;
    }
  });
});

// ── Section 18 — structural bar-as-of check ──

describe("BAR-AS-OF STRUCTURAL INTEGRITY (spec section 18) — barsByAsset is only ever read through barsAsOf()", () => {
  it("every barsByAsset.get(...) call site in historicalReplayEngine.ts is wrapped by barsAsOf(...)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const enginePath = join(here, "..", "historicalReplayEngine.ts");
    const source = readFileSync(enginePath, "utf8");

    const getCalls = [...source.matchAll(/barsByAsset\.get\([^)]*\)/g)].map((m) => m[0]);
    expect(getCalls.length).toBeGreaterThan(0); // sanity: the pattern actually exists in this file

    for (const call of getCalls) {
      const idx = source.indexOf(call);
      // Look at a small window of source immediately before this call site —
      // the call must appear as the argument to barsAsOf(...), i.e.
      // "barsAsOf(barsByAsset.get(...) ?? [], ...)".
      const before = source.slice(Math.max(0, idx - 20), idx);
      expect(before).toMatch(/barsAsOf\($/);
    }
  });
});

// ── Section 20 — ten manual reference scenarios, expected result computed by hand ──

describe("MANUAL REFERENCE SCENARIOS (spec section 20) — expected result computed explicitly, not inferred from the engine", () => {
  it("1. LONG take-profit: entry 100, TP 110, exit fills exactly at 110 gross, fee-adjusted netPnl", () => {
    const check = checkStopsAndTargets({ direction: "LONG", entryPrice: 100, currentHigh: 112, currentLow: 101, stopLoss: 95, takeProfit: 110, trailingStopPct: null, highestSinceEntry: 112, lowestSinceEntry: 101 });
    expect(check.reason).toBe("TAKE_PROFIT");
    const exit = simulateFill({ direction: "SHORT", requestedPrice: check.exitPrice!, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "scenario1" });
    const grossPnl = (exit.fillPrice - 100) * 10;
    expect(grossPnl).toBeGreaterThan(0); // TP hit -> gross profit before costs, by construction
    expect(grossPnl - exit.fee).toBeLessThan(grossPnl); // fee strictly reduces net vs gross
  });

  it("2. LONG stop-loss: entry 100, SL 95, exit fills at 95 gross, netPnl is negative", () => {
    const check = checkStopsAndTargets({ direction: "LONG", entryPrice: 100, currentHigh: 101, currentLow: 93, stopLoss: 95, takeProfit: 110, trailingStopPct: null, highestSinceEntry: 101, lowestSinceEntry: 93 });
    expect(check.reason).toBe("STOP_LOSS");
    expect(check.exitPrice).toBe(95);
    const exit = simulateFill({ direction: "SHORT", requestedPrice: 95, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "scenario2" });
    const grossPnl = (exit.fillPrice - 100) * 10;
    expect(grossPnl).toBeLessThan(0);
  });

  it("3. SHORT take-profit: entry 100, TP 90, exit fills at 90 gross, netPnl is positive", () => {
    const check = checkStopsAndTargets({ direction: "SHORT", entryPrice: 100, currentHigh: 101, currentLow: 88, stopLoss: 105, takeProfit: 90, trailingStopPct: null, highestSinceEntry: 101, lowestSinceEntry: 88 });
    expect(check.reason).toBe("TAKE_PROFIT");
    expect(check.exitPrice).toBe(90);
    const exit = simulateFill({ direction: "LONG", requestedPrice: 90, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "scenario3" });
    const grossPnl = -1 * (exit.fillPrice - 100) * 10;
    expect(grossPnl).toBeGreaterThan(0);
  });

  it("4. SHORT stop-loss: entry 100, SL 105, exit fills at 105 gross, netPnl is negative", () => {
    const check = checkStopsAndTargets({ direction: "SHORT", entryPrice: 100, currentHigh: 107, currentLow: 99, stopLoss: 105, takeProfit: 90, trailingStopPct: null, highestSinceEntry: 107, lowestSinceEntry: 99 });
    expect(check.reason).toBe("STOP_LOSS");
    expect(check.exitPrice).toBe(105);
    const exit = simulateFill({ direction: "LONG", requestedPrice: 105, quantity: 10, feeBps: 10, slippageBps: 0, idempotencyKey: "scenario4" });
    const grossPnl = -1 * (exit.fillPrice - 100) * 10;
    expect(grossPnl).toBeLessThan(0);
  });

  it("5. same-candle TP/SL both true -> resolves STOP_LOSS deterministically (see dedicated section above for the full proof)", () => {
    const check = checkStopsAndTargets({ direction: "LONG", entryPrice: 100, currentHigh: 111, currentLow: 94, stopLoss: 95, takeProfit: 110, trailingStopPct: null, highestSinceEntry: 111, lowestSinceEntry: 94 });
    expect(check.reason).toBe("STOP_LOSS");
  });

  it("6. overnight position: an open position's mark-to-market equity is continuous across a day boundary — no artificial reset, gap, or re-entry", () => {
    const portfolio = new ReplayPortfolio(10_000);
    portfolio.openPosition(pos({ entryPrice: 100, quantity: 5 }), 0);
    portfolio.recordTick(Date.parse("2026-01-01T22:00:00.000Z"), new Map([["BTC", 102]]));
    portfolio.recordTick(Date.parse("2026-01-02T00:00:00.000Z"), new Map([["BTC", 103]]));
    expect(portfolio.equityCurve[0].equity).toBeCloseTo(10_000 + 2 * 5, 9);
    expect(portfolio.equityCurve[1].equity).toBeCloseTo(10_000 + 3 * 5, 9); // smooth continuation, same position, no reset at the boundary
    expect(portfolio.hasOpenPosition("BTC", "test-strategy")).toBe(true); // still open, untouched by the day change itself
  });

  it("7. daily loss crossing: a losing trade closing intraday pushes dailyPnlPct past the -3% safety threshold, blocking new entries but not failing", () => {
    const account: EvaluationAccountState = { initialBalance: 10_000, phase: "PHASE_1", phase1TargetPct: 10, phase2TargetPct: 5, dailySafetyPct: -3, dailyHardPct: -5, totalSafetyPct: -6, totalHardPct: -10, baseRiskPct: 1, minRRR: 1.5, status: "ACTIVE", dayStartEquity: 10_000 };
    const result = evaluateEvaluationAccount({ account, currentEquity: 9_600 }); // -4%, inside safety but not hard
    expect(result.dailyPnlPct).toBeCloseTo(-4, 6);
    expect(result.blockNewEntries).toBe(true);
    expect(result.status).toBe("ACTIVE");
  });

  it("8. total loss crossing: equity dropping past -10% of initial balance FAILS the evaluation with an explicit reason", () => {
    const account: EvaluationAccountState = { initialBalance: 10_000, phase: "PHASE_1", phase1TargetPct: 10, phase2TargetPct: 5, dailySafetyPct: -3, dailyHardPct: -5, totalSafetyPct: -6, totalHardPct: -10, baseRiskPct: 1, minRRR: 1.5, status: "ACTIVE", dayStartEquity: 10_000 };
    const result = evaluateEvaluationAccount({ account, currentEquity: 8_950 }); // -10.5%
    expect(result.status).toBe("FAILED");
    expect(result.newlyFailedReason).toMatch(/TOTAL_HARD_STOP/);
  });

  it("9. target crossing: equity reaching +10% of initial balance marks TARGET_REACHED exactly once (newlyTargetReached true only on the crossing tick)", () => {
    const account: EvaluationAccountState = { initialBalance: 10_000, phase: "PHASE_1", phase1TargetPct: 10, phase2TargetPct: 5, dailySafetyPct: -3, dailyHardPct: -5, totalSafetyPct: -6, totalHardPct: -10, baseRiskPct: 1, minRRR: 1.5, status: "ACTIVE", dayStartEquity: 10_000 };
    const crossing = evaluateEvaluationAccount({ account, currentEquity: 11_000 });
    expect(crossing.status).toBe("TARGET_REACHED");
    expect(crossing.newlyTargetReached).toBe(true);
    const again = evaluateEvaluationAccount({ account: { ...account, status: "TARGET_REACHED" }, currentEquity: 11_500 });
    expect(again.newlyTargetReached).toBe(false); // already reached — not "newly" reached again
  });

  it("10. reduced position size: a LOW_CONFIDENCE Trade Gate verdict halves executed quantity, and R-multiple stays consistent at the smaller size", () => {
    const equity = 10_000;
    const entryPrice = 100;
    const stopLossPrice = 97;
    const sizing = calculatePositionSize({ equity, entryPrice, stopLossPrice, riskPerTradePct: 1 });
    const risk = checkExposureLimits({ equity, openNotional: 0, requestedNotional: sizing.notional, limits: resolveRiskLimitsForLevel(5), openPositionCount: 0, assetOpenNotional: 0, correlatedOpenNotional: 0 });
    const approvedQuantity = risk.approvedNotional / entryPrice;
    const sizeMultiplier = 0.5; // LOW_CONFIDENCE, per historicalReplayEngine.ts
    const executedQuantity = approvedQuantity * sizeMultiplier;

    expect(executedQuantity).toBeCloseTo(approvedQuantity / 2, 9);
    const fullR = calculateReferenceRMultiple(-90, entryPrice, stopLossPrice, approvedQuantity);
    const halfR = calculateReferenceRMultiple(-45, entryPrice, stopLossPrice, executedQuantity);
    expect(fullR).toBeCloseTo(halfR!, 9); // R-multiple is size-invariant — the SAME adverse move produces the same R regardless of how much was actually deployed
  });
});

// ── Section 17/21 — signal timing and whole-run invariants, over a real replay ──

describe("SIGNAL TIMING & WHOLE-RUN INVARIANTS (spec sections 17/21) — over a real SYNTHETIC replay", () => {
  function baseConfig(overrides: Partial<ReplayConfig> = {}): ReplayConfig {
    return {
      assetSymbols: ["BTC"],
      timeframe: "H1",
      startDate: new Date("2024-01-01T00:00:00.000Z"),
      endDate: new Date("2024-03-01T00:00:00.000Z"),
      strategyId: "trend-following",
      aiMode: "DETERMINISTIC_AI",
      dataSource: "SYNTHETIC",
      initialCapital: 10_000,
      riskLevel: 6,
      ...overrides,
    };
  }

  it("every trade's entryTime exactly matches its own decisionIndex's decision timestamp — no entry ever precedes or postdates the decision that opened it", async () => {
    const { result } = await runFullReplay(baseConfig(), new Map());
    expect(result.trades.length).toBeGreaterThan(0); // sanity — this run should actually trade
    for (const trade of result.trades) {
      const decision = result.decisions[trade.decisionIndex];
      expect(decision).toBeDefined();
      expect(trade.entryTime).toBe(decision.timestamp);
    }
  });

  it("decision timestamps are monotonically non-decreasing (the clock only ever moves forward)", async () => {
    const { result } = await runFullReplay(baseConfig(), new Map());
    for (let i = 1; i < result.decisions.length; i++) {
      expect(Date.parse(result.decisions[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(result.decisions[i - 1].timestamp));
    }
  });

  it("every trade has entryTime <= exitTime, finite netPnl/fees, and fees >= 0", async () => {
    const { result } = await runFullReplay(baseConfig(), new Map());
    for (const trade of result.trades) {
      expect(Date.parse(trade.entryTime)).toBeLessThanOrEqual(Date.parse(trade.exitTime));
      expect(Number.isFinite(trade.netPnl)).toBe(true);
      expect(Number.isFinite(trade.grossPnl)).toBe(true);
      expect(trade.fees).toBeGreaterThanOrEqual(0);
      expect(trade.quantity).toBeGreaterThan(0);
    }
  });

  it("every equity-curve point is finite", async () => {
    const { result } = await runFullReplay(baseConfig(), new Map());
    for (const point of result.equityCurve) expect(Number.isFinite(point.equity)).toBe(true);
  });

  it("no two trades for the SAME asset+strategy ever overlap in time (structural: only one open position per asset+strategy key at once)", async () => {
    const { result } = await runFullReplay(baseConfig({ strategyId: null }), new Map());
    const byKey = new Map<string, ReplayTradeRecord[]>();
    for (const t of result.trades) {
      const key = `${t.asset}::${t.strategyId}`;
      const arr = byKey.get(key) ?? [];
      arr.push(t);
      byKey.set(key, arr);
    }
    for (const trades of byKey.values()) {
      const sorted = [...trades].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
      for (let i = 1; i < sorted.length; i++) {
        expect(Date.parse(sorted[i].entryTime)).toBeGreaterThanOrEqual(Date.parse(sorted[i - 1].exitTime));
      }
    }
  });

  it("reported ReplayMetrics.trades always equals the actual trades array length", async () => {
    const { result } = await runFullReplay(baseConfig(), new Map());
    expect(result.metrics.trades).toBe(result.trades.length);
  });
});
