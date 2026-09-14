import { describe, expect, it } from "vitest";
import { runMt5ExecutionChecklist, type Mt5ExecutionChecklistInput } from "../executionChecklist";
import type { EvaluationEvalResult } from "@/lib/evaluation/evaluationRiskEngine";

const APPROVED_EVALUATION: EvaluationEvalResult = {
  status: "ACTIVE",
  totalPnlPct: 1,
  dailyPnlPct: 0.5,
  currentRiskPct: 1,
  currentRiskReason: "BASE_RISK",
  blockNewEntries: false,
  newlyFailedReason: null,
  newlyTargetReached: false,
};

const THRESHOLDS = { dailyHardPct: -5, totalHardPct: -10, minRRR: 1.5 };

function baseInput(overrides: Partial<Mt5ExecutionChecklistInput> = {}): Mt5ExecutionChecklistInput {
  return {
    signal: {
      strategyId: "strat-1",
      symbol: "EURUSD",
      signalTimestamp: new Date("2026-01-01T00:00:00Z"),
      direction: "BUY",
      entryPrice: 1.1,
      stopLoss: 1.09, // 100-pip risk
      takeProfit: 1.12, // 200-pip reward -> RRR 2.0
    },
    connection: { status: "CONNECTED", verifiedDemo: true, executionEnabled: true },
    symbolResolution: { ok: true, mt5Symbol: "EURUSDm" },
    evaluation: APPROVED_EVALUATION,
    evaluationThresholds: THRESHOLDS,
    tradeGate: { approved: true, blockedBy: null },
    riskCheck: { passed: true, violationKinds: [] },
    openPositionCount: 1,
    maxOpenPositions: 4,
    positionSizing: { approved: true, volume: 0.1, riskAmount: 100, notional: 11000 },
    ...overrides,
  };
}

describe("MT5 Fase 2, spec section 3 — all 15 checks pass", () => {
  it("approves with a volume, riskAmount, and rrr when every check passes", () => {
    const result = runMt5ExecutionChecklist(baseInput());
    expect(result.approved).toBe(true);
    expect(result.failedCheck).toBeNull();
    expect(result.rejectionReason).toBeNull();
    expect(result.approvedVolume).toBe(0.1);
    expect(result.riskAmount).toBe(100);
    expect(result.rrr).toBeCloseTo(2, 5);
    expect(result.steps).toHaveLength(16);
    expect(result.steps.every((s) => s.passed)).toBe(true);
  });
});

describe("MT5 Fase 2, spec section 3 — each individual check rejects", () => {
  it("1. SYMBOL_AVAILABLE fails when the symbol can't be resolved", () => {
    const result = runMt5ExecutionChecklist(baseInput({ symbolResolution: { ok: false, reason: "no mapping" } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("SYMBOL_AVAILABLE");
  });

  it("2. MT5_CONNECTED fails when not connected", () => {
    const result = runMt5ExecutionChecklist(baseInput({ connection: { status: "DISCONNECTED", verifiedDemo: true, executionEnabled: true } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("MT5_CONNECTED");
  });

  it("3. ACCOUNT_VERIFIED_DEMO fails when the account isn't verified demo (LIVE never sneaks through)", () => {
    const result = runMt5ExecutionChecklist(baseInput({ connection: { status: "CONNECTED", verifiedDemo: false, executionEnabled: true } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("ACCOUNT_VERIFIED_DEMO");
  });

  it("4. SAFETY_SWITCH_ON fails when execution is disabled", () => {
    const result = runMt5ExecutionChecklist(baseInput({ connection: { status: "CONNECTED", verifiedDemo: true, executionEnabled: false } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("SAFETY_SWITCH_ON");
  });

  it("5. EVALUATION_ACCOUNT_ACTIVE fails when there is no evaluation account configured", () => {
    const result = runMt5ExecutionChecklist(baseInput({ evaluation: null, evaluationThresholds: null }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("EVALUATION_ACCOUNT_ACTIVE");
  });

  it("6. EVALUATION_NOT_FAILED fails once the evaluation is FAILED", () => {
    const result = runMt5ExecutionChecklist(baseInput({ evaluation: { ...APPROVED_EVALUATION, status: "FAILED" } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("EVALUATION_NOT_FAILED");
  });

  it("7. EVALUATION_TARGET_NOT_REACHED fails once the evaluation hit TARGET_REACHED", () => {
    const result = runMt5ExecutionChecklist(baseInput({ evaluation: { ...APPROVED_EVALUATION, status: "TARGET_REACHED" } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("EVALUATION_TARGET_NOT_REACHED");
  });

  it("8. DAILY_LIMITS_OK fails when blockNewEntries is true (daily safety zone)", () => {
    const result = runMt5ExecutionChecklist(baseInput({ evaluation: { ...APPROVED_EVALUATION, blockNewEntries: true } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("DAILY_LIMITS_OK");
  });

  it("8b. DAILY_LIMITS_OK fails when dailyPnlPct is at/below the daily hard stop", () => {
    const result = runMt5ExecutionChecklist(baseInput({ evaluation: { ...APPROVED_EVALUATION, dailyPnlPct: -6 } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("DAILY_LIMITS_OK");
  });

  it("9. TOTAL_LIMITS_OK fails when totalPnlPct is at/below the total hard stop", () => {
    const result = runMt5ExecutionChecklist(baseInput({ evaluation: { ...APPROVED_EVALUATION, totalPnlPct: -11 } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("TOTAL_LIMITS_OK");
  });

  it("10. RISK_ENGINE_APPROVES fails when the shared Risk Engine check didn't pass", () => {
    const result = runMt5ExecutionChecklist(baseInput({ riskCheck: { passed: false, violationKinds: ["EXPOSURE"] } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("RISK_ENGINE_APPROVES");
  });

  it("10b. RISK_ENGINE_APPROVES fails when MT5 position sizing itself was rejected", () => {
    const result = runMt5ExecutionChecklist(baseInput({ positionSizing: { approved: false, reason: "BELOW_MINIMUM_VOLUME", detail: "too small" } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("RISK_ENGINE_APPROVES");
  });

  it("11. TRADE_GATE_APPROVES fails when the Trade Gate didn't approve", () => {
    const result = runMt5ExecutionChecklist(baseInput({ tradeGate: { approved: false, blockedBy: "AI_ANALYST" } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("TRADE_GATE_APPROVES");
  });

  it("12. MAX_OPEN_POSITIONS_OK fails at the configured ceiling", () => {
    const result = runMt5ExecutionChecklist(baseInput({ openPositionCount: 4, maxOpenPositions: 4 }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("MAX_OPEN_POSITIONS_OK");
  });

  it("13. EXPOSURE_OK fails when the Risk Engine flagged an EXPOSURE violation", () => {
    const result = runMt5ExecutionChecklist(baseInput({ riskCheck: { passed: true, violationKinds: ["EXPOSURE"] } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("EXPOSURE_OK");
  });

  it("14. CONCENTRATION_OK fails when the Risk Engine flagged a CONCENTRATION violation", () => {
    const result = runMt5ExecutionChecklist(baseInput({ riskCheck: { passed: true, violationKinds: ["CONCENTRATION"] } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("CONCENTRATION_OK");
  });

  it("15. CORRELATION_OK fails when the Risk Engine flagged a CORRELATION violation", () => {
    const result = runMt5ExecutionChecklist(baseInput({ riskCheck: { passed: true, violationKinds: ["CORRELATION"] } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("CORRELATION_OK");
  });

  it("16. SL_TP_RRR_VALID fails when SL/TP sit on the wrong side of entry for a BUY", () => {
    const result = runMt5ExecutionChecklist(baseInput({ signal: { ...baseInput().signal, stopLoss: 1.11, takeProfit: 1.09 } }));
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("SL_TP_RRR_VALID");
  });

  it("16b. SL_TP_RRR_VALID fails when RRR is below the evaluation's minRRR", () => {
    const result = runMt5ExecutionChecklist(baseInput({ signal: { ...baseInput().signal, takeProfit: 1.105 } })); // RRR = 0.5
    expect(result.approved).toBe(false);
    expect(result.failedCheck).toBe("SL_TP_RRR_VALID");
  });
});

describe("MT5 Fase 2, spec section 3 — failedCheck picks the FIRST failing step in checklist order", () => {
  it("when connection AND evaluation both fail, MT5_CONNECTED (earlier in the list) wins", () => {
    const result = runMt5ExecutionChecklist(
      baseInput({
        connection: { status: "DISCONNECTED", verifiedDemo: false, executionEnabled: false },
        evaluation: { ...APPROVED_EVALUATION, status: "FAILED" },
      })
    );
    expect(result.failedCheck).toBe("MT5_CONNECTED");
  });

  it("every check still runs even after an early one fails — the audit trail is always complete", () => {
    const result = runMt5ExecutionChecklist(baseInput({ connection: { status: "DISCONNECTED", verifiedDemo: false, executionEnabled: false } }));
    expect(result.steps).toHaveLength(16);
    expect(result.steps.map((s) => s.name)).toContain("SL_TP_RRR_VALID"); // the LAST check still ran
  });
});
