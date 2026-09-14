import type { EvaluationEvalResult } from "@/lib/evaluation/evaluationRiskEngine";
import type { RiskViolationKind } from "@/lib/engines/riskEngine";
import type { Mt5ConnectionStatus, OrderSide } from "./types";
import type { Mt5PositionSizeResult } from "./mt5PositionSizing";
import type { ResolveMt5SymbolResult } from "./mt5SymbolMapper";

/**
 * MT5 Fase 2, spec section 3 — the 15-point pre-flight checklist every DEMO
 * order must clear. Every check ALWAYS runs (never short-circuits, same
 * philosophy as `tradeGate.ts`) so the full audit trail is always complete,
 * but the order below IS the priority used to pick `failedCheck` when more
 * than one check fails at once — connection/account/safety-switch first,
 * then evaluation state, then the trading-specific checks.
 *
 * This is a pure function: every input is an already-computed value (the
 * connection row's fields, the evaluation engine's result, the SAME
 * `RiskCheckResult`/Trade Gate verdict the paper-trading pipeline computes
 * for this exact candidate) — nothing here re-derives risk or re-runs the
 * Trade Gate, so there is exactly one source of truth for each of those
 * decisions, never a second, possibly-inconsistent copy.
 */

export interface Mt5ExecutionChecklistSignal {
  strategyId: string;
  symbol: string;
  signalTimestamp: Date;
  direction: OrderSide;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
}

export interface Mt5ExecutionChecklistInput {
  signal: Mt5ExecutionChecklistSignal;
  connection: { status: Mt5ConnectionStatus; verifiedDemo: boolean; executionEnabled: boolean };
  symbolResolution: ResolveMt5SymbolResult;
  evaluation: EvaluationEvalResult | null;
  evaluationThresholds: { dailyHardPct: number; totalHardPct: number; minRRR: number } | null;
  tradeGate: { approved: boolean; blockedBy: string | null };
  riskCheck: { passed: boolean; violationKinds: RiskViolationKind[] };
  openPositionCount: number;
  maxOpenPositions: number;
  positionSizing: Mt5PositionSizeResult;
}

export interface Mt5ExecutionCheckStep {
  name: string;
  passed: boolean;
  detail: string | null;
}

export interface Mt5ExecutionChecklistResult {
  approved: boolean;
  steps: Mt5ExecutionCheckStep[];
  /** The FIRST failing check's name, in checklist order — what gets persisted to ExecutionEvent.failedCheck. Null when approved. */
  failedCheck: string | null;
  rejectionReason: string | null;
  approvedVolume: number | null;
  riskAmount: number | null;
  rrr: number | null;
}

function computeRrr(signal: Mt5ExecutionChecklistSignal): number | null {
  const rewardDistance = Math.abs(signal.takeProfit - signal.entryPrice);
  const riskDistance = Math.abs(signal.entryPrice - signal.stopLoss);
  if (riskDistance <= 0) return null;
  return rewardDistance / riskDistance;
}

function slTpOnCorrectSide(signal: Mt5ExecutionChecklistSignal): boolean {
  if (signal.direction === "BUY") {
    return signal.stopLoss < signal.entryPrice && signal.takeProfit > signal.entryPrice;
  }
  return signal.stopLoss > signal.entryPrice && signal.takeProfit < signal.entryPrice;
}

export function runMt5ExecutionChecklist(input: Mt5ExecutionChecklistInput): Mt5ExecutionChecklistResult {
  const steps: Mt5ExecutionCheckStep[] = [];
  const push = (name: string, passed: boolean, detail: string | null = null) => steps.push({ name, passed, detail });

  push("SYMBOL_AVAILABLE", input.symbolResolution.ok, input.symbolResolution.ok ? null : input.symbolResolution.reason);

  push("MT5_CONNECTED", input.connection.status === "CONNECTED", input.connection.status === "CONNECTED" ? null : "MT5 no está conectado.");
  push("ACCOUNT_VERIFIED_DEMO", input.connection.verifiedDemo, input.connection.verifiedDemo ? null : "La cuenta no está verificada como DEMO.");
  push("SAFETY_SWITCH_ON", input.connection.executionEnabled, input.connection.executionEnabled ? null : "MT5 Demo Execution Safety Switch está OFF.");

  push("EVALUATION_ACCOUNT_ACTIVE", input.evaluation !== null, input.evaluation !== null ? null : "No hay una Evaluation Account configurada.");

  const evaluation = input.evaluation;
  const thresholds = input.evaluationThresholds;
  push("EVALUATION_NOT_FAILED", evaluation ? evaluation.status !== "FAILED" : false, evaluation?.status === "FAILED" ? "La evaluación ya está en estado FAILED." : null);
  push("EVALUATION_TARGET_NOT_REACHED", evaluation ? evaluation.status !== "TARGET_REACHED" : false, evaluation?.status === "TARGET_REACHED" ? "La evaluación ya alcanzó el target (TARGET_REACHED)." : null);

  const dailyOk = evaluation && thresholds ? !evaluation.blockNewEntries && (evaluation.dailyPnlPct === null || evaluation.dailyPnlPct > thresholds.dailyHardPct) : false;
  push("DAILY_LIMITS_OK", dailyOk, dailyOk ? null : "Límite diario de la evaluación alcanzado (safety o hard stop).");

  const totalOk = evaluation && thresholds ? evaluation.totalPnlPct > thresholds.totalHardPct : false;
  push("TOTAL_LIMITS_OK", totalOk, totalOk ? null : "Límite total de la evaluación alcanzado (hard stop).");

  push("RISK_ENGINE_APPROVES", input.riskCheck.passed && input.positionSizing.approved, input.riskCheck.passed && input.positionSizing.approved ? null : "El Risk Engine o el cálculo de tamaño MT5 rechazó la señal.");
  push("TRADE_GATE_APPROVES", input.tradeGate.approved, input.tradeGate.approved ? null : `Trade Gate no aprobó (${input.tradeGate.blockedBy ?? "desconocido"}).`);

  const maxPositionsOk = input.openPositionCount < input.maxOpenPositions;
  push("MAX_OPEN_POSITIONS_OK", maxPositionsOk, maxPositionsOk ? null : `Se alcanzó el máximo de posiciones abiertas (${input.maxOpenPositions}).`);

  push("EXPOSURE_OK", !input.riskCheck.violationKinds.includes("EXPOSURE"), input.riskCheck.violationKinds.includes("EXPOSURE") ? "Límite de exposición excedido." : null);
  push("CONCENTRATION_OK", !input.riskCheck.violationKinds.includes("CONCENTRATION"), input.riskCheck.violationKinds.includes("CONCENTRATION") ? "Límite de concentración por activo excedido." : null);
  push("CORRELATION_OK", !input.riskCheck.violationKinds.includes("CORRELATION"), input.riskCheck.violationKinds.includes("CORRELATION") ? "Límite de concentración por correlación excedido." : null);

  const rrr = computeRrr(input.signal);
  const minRRR = thresholds?.minRRR ?? Infinity;
  const slTpValid = slTpOnCorrectSide(input.signal);
  const rrrValid = rrr !== null && rrr >= minRRR;
  push("SL_TP_RRR_VALID", slTpValid && rrrValid, !slTpValid ? "SL/TP en el lado incorrecto de entryPrice." : !rrrValid ? `RRR ${rrr?.toFixed(2) ?? "N/A"} por debajo del mínimo ${minRRR}.` : null);

  const failedStep = steps.find((s) => !s.passed);
  const approved = failedStep === undefined;

  return {
    approved,
    steps,
    failedCheck: failedStep?.name ?? null,
    rejectionReason: failedStep?.detail ?? null,
    approvedVolume: approved && input.positionSizing.approved ? input.positionSizing.volume : null,
    riskAmount: input.positionSizing.approved ? input.positionSizing.riskAmount : null,
    rrr,
  };
}
