import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MT5DemoExecutionAdapter } from "../mt5DemoExecutionAdapter";
import { makeFakeMt5Client, LIVE_ACCOUNT } from "./testFixtures";
import { getConnectionRow, setExecutionEnabled } from "../mt5ConnectionStore";
import { setSymbolMapping } from "../mt5SymbolMapper";
import { createEvaluationAccount } from "@/lib/evaluation/evaluationAccountStore";
import { attemptMt5DemoExecution, prepareMt5ScanContext, type Mt5CandidateSignal, type Mt5ScanContext } from "../mt5ExecutionOrchestrator";
import { verifyMt5ConnectionSafety } from "../mt5ReconnectionGuard";
import { getMt5ExecutionAdapter, setMt5ExecutionAdapterForTesting } from "../registry";
import type { EvaluationEvalResult } from "@/lib/evaluation/evaluationRiskEngine";
import type { Mt5SymbolSpec } from "../types";

const TEST_SYMBOL = "ORCHTEST_EURUSD";
const MT5_SYMBOL = "EURUSDm";

const EURUSD_SPEC: Mt5SymbolSpec = {
  symbol: MT5_SYMBOL,
  tickSize: 0.0001,
  tickValue: 10,
  contractSize: 100000,
  volumeStep: 0.01,
  volumeMin: 0.01,
  volumeMax: 50,
  digits: 4,
};

const ACTIVE_EVALUATION: EvaluationEvalResult = {
  status: "ACTIVE",
  totalPnlPct: 1,
  dailyPnlPct: 0.5,
  currentRiskPct: 1,
  currentRiskReason: "BASE_RISK",
  blockNewEntries: false,
  newlyFailedReason: null,
  newlyTargetReached: false,
};

async function connectFreshDemo(overrides: Parameters<typeof makeFakeMt5Client>[0] = {}) {
  const adapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ symbols: async () => [MT5_SYMBOL], symbolInfo: async () => EURUSD_SPEC, ...overrides }));
  await adapter.connect({ login: "1234567", password: "hunter2-super-secret", server: "TestBroker-Demo" });
  await setExecutionEnabled(true);
  return adapter;
}

async function resetAll() {
  await prisma.mT5DemoConnection.deleteMany({ where: { id: "main" } });
  await prisma.evaluationAccount.deleteMany({ where: { id: "main" } });
  await prisma.mt5SymbolMapping.deleteMany({ where: { edgeLabSymbol: TEST_SYMBOL } });
  await prisma.mt5DemoPosition.deleteMany({ where: { symbol: MT5_SYMBOL } });
  // adapter.placeOrder() logs its OWN ExecutionEvent under the MT5 broker
  // symbol (request.symbol), not the EdgeLab symbol — clean up both, or a
  // leftover row's idempotencyKey (built from the EdgeLab symbol, shared
  // by every test using the default candidateSignal()) silently blocks
  // every later test via the duplicate-order guard.
  await prisma.executionEvent.deleteMany({ where: { OR: [{ symbol: TEST_SYMBOL }, { symbol: MT5_SYMBOL }] } });
  setMt5ExecutionAdapterForTesting(null);
}

// MT5 Data Connector phase added an env-level kill switch
// (ENABLE_DEMO_EXECUTION) on top of everything these MT5 Fase 2
// orchestrator tests already exercise. Before that phase there was no env
// gate at all — equivalent to always-on — so this file opts every test
// into that equivalent state.
const ORIGINAL_ENABLE_DEMO_EXECUTION = process.env.ENABLE_DEMO_EXECUTION;
beforeEach(async () => {
  process.env.ENABLE_DEMO_EXECUTION = "true";
  await resetAll();
  await setSymbolMapping(TEST_SYMBOL, MT5_SYMBOL);
});
afterEach(async () => {
  if (ORIGINAL_ENABLE_DEMO_EXECUTION === undefined) delete process.env.ENABLE_DEMO_EXECUTION;
  else process.env.ENABLE_DEMO_EXECUTION = ORIGINAL_ENABLE_DEMO_EXECUTION;
  await resetAll();
});

function candidateSignal(overrides: Partial<Mt5CandidateSignal> = {}): Mt5CandidateSignal {
  return {
    strategyId: "orch-strat-1",
    edgeLabSymbol: TEST_SYMBOL,
    direction: "BUY",
    signalTimestamp: new Date("2026-02-01T10:00:00Z"),
    entryPrice: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.12,
    tradeGateApproved: true,
    tradeGateBlockedBy: null,
    ...overrides,
  };
}

async function buildScanContext(adapter: MT5DemoExecutionAdapter, evaluation: EvaluationEvalResult = ACTIVE_EVALUATION): Promise<Mt5ScanContext> {
  return {
    adapter,
    evaluation,
    evaluationThresholds: { dailyHardPct: -5, totalHardPct: -10, minRRR: 1.5, maxOpenPositions: 4, maxExposurePct: 50, maxConcentrationPct: 25 },
  };
}

describe("MT5 Fase 2, spec section 3/7 — attemptMt5DemoExecution: all checks pass", () => {
  it("places a real (fake-adapter) order, records a FILLED ExecutionEvent with the checklist's audit fields, and syncs the position", async () => {
    // The fake client's `positions()` and `orderSend()` are independent
    // mocks by default (see testFixtures.ts) — wiring this one to report
    // the just-placed ticket as an open position is what lets this test
    // actually verify `syncMt5Positions` ran, not just that it didn't throw.
    const adapter = await connectFreshDemo({
      positions: async () => [
        { ticket: "999", symbol: MT5_SYMBOL, side: "BUY", volume: 0.03, entryPrice: 1.1, currentPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, unrealizedPnl: 0, openTime: new Date() },
      ],
    });
    const ctx = await buildScanContext(adapter);

    await attemptMt5DemoExecution(ctx, candidateSignal());

    const event = await prisma.executionEvent.findFirst({ where: { symbol: TEST_SYMBOL } });
    expect(event?.status).toBe("FILLED");
    expect(event?.mt5Ticket).toBe("999");
    expect(event?.rrr).toBeCloseTo(2, 5); // (1.12-1.10)/(1.10-1.09) = 2
    expect(event?.riskAmount).toBeGreaterThan(0);

    const positions = await prisma.mt5DemoPosition.findMany({ where: { symbol: MT5_SYMBOL } });
    expect(positions).toHaveLength(1); // synced after FILLED, mirroring the adapter's own getOpenPositions()
    expect(positions[0].ticket).toBe("999");
  });
});

describe("MT5 Fase 2, spec section 8 — duplicate protection", () => {
  it("the exact same signal attempted twice creates exactly ONE execution request to the adapter", async () => {
    let orderSendCalls = 0;
    const adapter = await connectFreshDemo({
      orderSend: async () => {
        orderSendCalls += 1;
        return { status: "FILLED", ticket: "555", filledPrice: 1.1, executionLatencyMs: 5, rejectionReason: null };
      },
    });
    const ctx = await buildScanContext(adapter);
    const signal = candidateSignal();

    await attemptMt5DemoExecution(ctx, signal);
    await attemptMt5DemoExecution(ctx, signal); // simulated retry/reconnect/restart of the exact same signal

    expect(orderSendCalls).toBe(1);
    const events = await prisma.executionEvent.findMany({ where: { symbol: TEST_SYMBOL } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("FILLED"); // never corrupted into FAILED_EXECUTION by the second attempt
  });
});

describe("MT5 Fase 2, spec section 9 — reconnection safety", () => {
  it("verifyMt5ConnectionSafety marks the connection unsafe and force-disconnects when the terminal reports not connected", async () => {
    const adapter = await connectFreshDemo({ isConnected: async () => false });
    const result = await verifyMt5ConnectionSafety(adapter);
    expect(result.safe).toBe(false);
    const row = await getConnectionRow();
    expect(row?.status).toBe("DISCONNECTED");
  });

  it("verifyMt5ConnectionSafety force-disables execution when the account is no longer verified DEMO, even though the terminal is still reachable", async () => {
    const adapter = await connectFreshDemo({ accountInfo: async () => LIVE_ACCOUNT });
    const result = await verifyMt5ConnectionSafety(adapter);
    expect(result.safe).toBe(false);
    const row = await getConnectionRow();
    expect(row?.executionEnabled).toBe(false);
    expect(row?.verifiedDemo).toBe(false);
  });

  it("prepareMt5ScanContext returns null (never a fabricated context) once the terminal disconnects mid-session", async () => {
    const adapter = await connectFreshDemo();
    await createEvaluationAccount("20K");
    setMt5ExecutionAdapterForTesting(adapter);
    expect(await prepareMt5ScanContext()).not.toBeNull();

    // Simulate the terminal dropping — a fresh adapter instance reporting disconnected.
    const droppedAdapter = new MT5DemoExecutionAdapter(makeFakeMt5Client({ isConnected: async () => false }));
    setMt5ExecutionAdapterForTesting(droppedAdapter);
    expect(await prepareMt5ScanContext()).toBeNull();

    const row = await getConnectionRow();
    expect(row?.status).toBe("DISCONNECTED"); // new orders stop immediately, this same tick
  });

  it("execution never silently resumes just because the terminal reconnects — the Safety Switch stays off until an explicit human re-enable", async () => {
    const adapter = await connectFreshDemo({ isConnected: async () => false });
    await verifyMt5ConnectionSafety(adapter); // detects the drop, marks DISCONNECTED (executionEnabled forced false)

    const row = await getConnectionRow();
    expect(row?.status).toBe("DISCONNECTED");
    expect(row?.executionEnabled).toBe(false);
    // Nothing in this module ever flips executionEnabled back to true — only
    // an explicit POST /api/mt5/execution-switch call does (see
    // mt5ReconnectionGuard.ts's doc comment). There is no "terminal is
    // reachable again" code path here to re-verify, by construction.
  });
});

describe("MT5 Fase 2, spec section 3 — demo verification failure blocks execution end-to-end", () => {
  it("a LIVE-verified connection never places an order, even with everything else configured correctly", async () => {
    let orderSendCalls = 0;
    const adapter = new MT5DemoExecutionAdapter(
      makeFakeMt5Client({ accountInfo: async () => LIVE_ACCOUNT, symbols: async () => [MT5_SYMBOL], symbolInfo: async () => EURUSD_SPEC, orderSend: async () => { orderSendCalls += 1; return { status: "FILLED", ticket: "1", filledPrice: 1.1, executionLatencyMs: 1, rejectionReason: null }; } })
    );
    await adapter.connect({ login: "1234567", password: "hunter2-super-secret", server: "TestBroker-Live" });
    await setExecutionEnabled(true); // tamper attempt — defense in depth still blocks

    const ctx = await buildScanContext(adapter);
    await attemptMt5DemoExecution(ctx, candidateSignal());

    expect(orderSendCalls).toBe(0);
    const event = await prisma.executionEvent.findFirst({ where: { symbol: TEST_SYMBOL } });
    expect(event?.status).toBe("REJECTED");
    expect(event?.failedCheck).toBe("ACCOUNT_VERIFIED_DEMO");
  });
});

describe("MT5 Fase 2, spec section 2 — Evaluation Risk Layer blocks execution end-to-end", () => {
  it("a FAILED evaluation blocks new entries even though every other layer would approve", async () => {
    const adapter = await connectFreshDemo();
    const ctx = await buildScanContext(adapter, { ...ACTIVE_EVALUATION, status: "FAILED" });

    await attemptMt5DemoExecution(ctx, candidateSignal());

    const event = await prisma.executionEvent.findFirst({ where: { symbol: TEST_SYMBOL } });
    expect(event?.status).toBe("REJECTED");
    expect(event?.failedCheck).toBe("EVALUATION_NOT_FAILED");
  });
});

describe("MT5 Fase 2, spec section 19 — optional layer: no context, no crash", () => {
  it("prepareMt5ScanContext returns null when disconnected, and getMt5ExecutionAdapter defaults to the unavailable client", async () => {
    expect(await prepareMt5ScanContext()).toBeNull();
    expect(getMt5ExecutionAdapter().id).toBe("mt5-demo");
  });
});
