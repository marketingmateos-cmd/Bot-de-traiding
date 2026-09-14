import { computeEvaluationDayKey, evaluateEvaluationAccount, type EvaluationAccountState, type EvaluationPhase } from "@/lib/evaluation/evaluationRiskEngine";

/**
 * Fase 11 — Strategy Research & Evaluation Benchmark, spec sections 9/15/16.
 *
 * Reuses `evaluateEvaluationAccount()` (the SAME pure Evaluation Risk Engine
 * the live MT5 pipeline uses — never duplicated) as an ANALYSIS LENS over a
 * replay's already-computed equity curve: walks it chronologically,
 * point-by-point, exactly as a live bot loop would evaluate the account on
 * every tick, and reports the single historical outcome that trajectory
 * produced. This is deliberately NOT a live-enforcement re-simulation (it
 * never removes trades that happened after a would-be FAILED point) — spec
 * section 16 is explicit that this phase produces a Historical Outcome
 * only, not a Probability of Passing from one path.
 */

export interface BenchmarkEvaluationProfile {
  initialBalance: number;
  phase: EvaluationPhase;
  phase1TargetPct: number;
  phase2TargetPct: number;
  dailySafetyPct: number;
  dailyHardPct: number;
  totalSafetyPct: number;
  totalHardPct: number;
  baseRiskPct: number;
  minRRR: number;
  resetHourUtc: number;
}

/** Spec section 15 — PASS only if the target was reached before any hard failure; FAIL only on an actual hard-limit breach; INCONCLUSIVE if the replay simply ended in neither state (never "FAIL" just for running out of time). */
export type BenchmarkOutcomeStatus = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface BenchmarkEvaluationResult {
  status: BenchmarkOutcomeStatus;
  targetReachedAt: string | null;
  daysToTarget: number | null;
  failedAt: string | null;
  daysUntilFailure: number | null;
  failureReason: string | null;
  dailyStopTriggered: boolean;
  totalStopTriggered: boolean;
  /** The single worst dailyPnlPct observed at any point in the run (most negative) — 0 if never negative. */
  maxDailyDrawdownPct: number;
  finalTotalPnlPct: number;
}

export function evaluateBenchmarkRun(equityCurve: { t: number; equity: number }[], profile: BenchmarkEvaluationProfile): BenchmarkEvaluationResult {
  const empty: BenchmarkEvaluationResult = {
    status: "INCONCLUSIVE",
    targetReachedAt: null,
    daysToTarget: null,
    failedAt: null,
    daysUntilFailure: null,
    failureReason: null,
    dailyStopTriggered: false,
    totalStopTriggered: false,
    maxDailyDrawdownPct: 0,
    finalTotalPnlPct: 0,
  };
  if (equityCurve.length === 0) return empty;

  const startMs = equityCurve[0].t;
  let status: EvaluationAccountState["status"] = "ACTIVE";
  let dayStartDate: string | null = null;
  let dayStartEquity: number | null = null;
  let dailyStopTriggered = false;
  let totalStopTriggered = false;
  let maxDailyDrawdownPct = 0;
  let targetReachedAt: string | null = null;
  let daysToTarget: number | null = null;
  let failedAt: string | null = null;
  let daysUntilFailure: number | null = null;
  let failureReason: string | null = null;
  let finalTotalPnlPct = 0;

  for (const point of equityCurve) {
    const dayKey = computeEvaluationDayKey(new Date(point.t), profile.resetHourUtc);
    if (dayStartDate !== dayKey) {
      dayStartDate = dayKey;
      dayStartEquity = point.equity;
    }

    const state: EvaluationAccountState = {
      initialBalance: profile.initialBalance,
      phase: profile.phase,
      phase1TargetPct: profile.phase1TargetPct,
      phase2TargetPct: profile.phase2TargetPct,
      dailySafetyPct: profile.dailySafetyPct,
      dailyHardPct: profile.dailyHardPct,
      totalSafetyPct: profile.totalSafetyPct,
      totalHardPct: profile.totalHardPct,
      baseRiskPct: profile.baseRiskPct,
      minRRR: profile.minRRR,
      status,
      dayStartEquity,
    };
    const result = evaluateEvaluationAccount({ account: state, currentEquity: point.equity });
    finalTotalPnlPct = result.totalPnlPct;

    if (result.dailyPnlPct !== null) {
      maxDailyDrawdownPct = Math.min(maxDailyDrawdownPct, result.dailyPnlPct);
      if (result.dailyPnlPct <= profile.dailyHardPct) dailyStopTriggered = true;
    }
    if (result.totalPnlPct <= profile.totalHardPct) totalStopTriggered = true;

    if (result.newlyTargetReached) {
      targetReachedAt = new Date(point.t).toISOString();
      daysToTarget = Math.max(1, Math.round((point.t - startMs) / 86_400_000));
    }
    if (result.newlyFailedReason) {
      failedAt = new Date(point.t).toISOString();
      daysUntilFailure = Math.max(1, Math.round((point.t - startMs) / 86_400_000));
      failureReason = result.newlyFailedReason;
    }
    status = result.status;
  }

  const outcome: BenchmarkOutcomeStatus = status === "TARGET_REACHED" ? "PASS" : status === "FAILED" ? "FAIL" : "INCONCLUSIVE";

  return { status: outcome, targetReachedAt, daysToTarget, failedAt, daysUntilFailure, failureReason, dailyStopTriggered, totalStopTriggered, maxDailyDrawdownPct, finalTotalPnlPct };
}
