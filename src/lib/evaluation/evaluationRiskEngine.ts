/**
 * MT5 Fase 2 — the prop-firm-style Evaluation Risk Engine. Pure functions
 * only; nothing here touches Prisma (see evaluationAccountStore.ts for
 * persistence) — every rule is a deterministic function of numbers, never
 * an AI opinion (spec section 23: "AI is not authority").
 */

export type EvaluationProfileType = "20K" | "50K" | "100K" | "CUSTOM";
export type EvaluationPhase = "PHASE_1" | "PHASE_2";
export type EvaluationStatus = "ACTIVE" | "TARGET_REACHED" | "FAILED";

export interface EvaluationProfileTemplate {
  profileType: EvaluationProfileType;
  initialBalance: number;
  phase1TargetPct: number;
  phase2TargetPct: number;
  dailySafetyPct: number; // negative
  dailyHardPct: number; // negative
  totalSafetyPct: number; // negative
  totalHardPct: number; // negative
  baseRiskPct: number;
  minRRR: number;
}

/** Spec section 1's example values — identical across 20K/50K/100K, only `initialBalance` differs, matching a typical prop-firm evaluation structure. */
const BASE_TEMPLATE = {
  phase1TargetPct: 10,
  phase2TargetPct: 5,
  dailySafetyPct: -3,
  dailyHardPct: -5,
  totalSafetyPct: -6,
  totalHardPct: -10,
  baseRiskPct: 1,
  minRRR: 1.5,
};

export const EVALUATION_PROFILE_TEMPLATES: Record<"20K" | "50K" | "100K", EvaluationProfileTemplate> = {
  "20K": { profileType: "20K", initialBalance: 20000, ...BASE_TEMPLATE },
  "50K": { profileType: "50K", initialBalance: 50000, ...BASE_TEMPLATE },
  "100K": { profileType: "100K", initialBalance: 100000, ...BASE_TEMPLATE },
};

export function resolveEvaluationTemplate(profileType: "20K" | "50K" | "100K" | "CUSTOM", custom?: Partial<EvaluationProfileTemplate> & { initialBalance: number }): EvaluationProfileTemplate {
  if (profileType === "CUSTOM") {
    if (!custom) throw new Error("Un perfil CUSTOM requiere valores explícitos (al menos initialBalance) — nunca se asumen valores por defecto silenciosamente.");
    return { profileType: "CUSTOM", ...BASE_TEMPLATE, ...custom };
  }
  return EVALUATION_PROFILE_TEMPLATES[profileType];
}

export interface EvaluationAccountState {
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
  status: EvaluationStatus;
  dayStartEquity: number | null;
}

export interface EvaluationEvalInput {
  account: EvaluationAccountState;
  currentEquity: number;
}

export interface EvaluationEvalResult {
  status: EvaluationStatus;
  totalPnlPct: number;
  dailyPnlPct: number | null; // null when dayStartEquity hasn't been established yet
  /** baseRiskPct, or baseRiskPct * 0.5 once totalPnlPct <= totalSafetyPct — see spec section 13. Never touched by AI. */
  currentRiskPct: number;
  currentRiskReason: "BASE_RISK" | "TOTAL_DRAWDOWN_PROTECTION";
  /** True while daily drawdown has hit the safety stop, OR the account is in a terminal state — the one flag executionChecklist.ts needs to decide "no new entries this cycle". */
  blockNewEntries: boolean;
  /** Populated only on a FRESH transition into FAILED this call — see evaluationAccountStore.ts for how failedReason/failedAt get persisted exactly once. */
  newlyFailedReason: string | null;
  /** Populated only on a FRESH transition into TARGET_REACHED this call. */
  newlyTargetReached: boolean;
}

/**
 * The single authority on evaluation state. Deliberately STICKY for
 * terminal states (spec sections 12/13): once `account.status` is already
 * FAILED or TARGET_REACHED, this always returns that same status — a
 * failed evaluation never un-fails just because equity later recovers, and
 * a target-reached evaluation never resumes trading just because equity
 * dips back under the target. Fresh transitions are reported via
 * `newlyFailedReason`/`newlyTargetReached` so the caller (evaluationAccountStore.ts)
 * knows to persist them exactly once, not on every single tick spent in
 * the same terminal state.
 */
export function evaluateEvaluationAccount(input: EvaluationEvalInput): EvaluationEvalResult {
  const { account, currentEquity } = input;
  const totalPnlPct = account.initialBalance > 0 ? ((currentEquity - account.initialBalance) / account.initialBalance) * 100 : 0;
  const dailyPnlPct = account.dayStartEquity !== null && account.dayStartEquity > 0 ? ((currentEquity - account.dayStartEquity) / account.dayStartEquity) * 100 : null;

  // Terminal states are sticky — re-derive nothing once already there.
  if (account.status === "FAILED") {
    return { status: "FAILED", totalPnlPct, dailyPnlPct, currentRiskPct: account.baseRiskPct, currentRiskReason: "BASE_RISK", blockNewEntries: true, newlyFailedReason: null, newlyTargetReached: false };
  }
  if (account.status === "TARGET_REACHED") {
    return { status: "TARGET_REACHED", totalPnlPct, dailyPnlPct, currentRiskPct: account.baseRiskPct, currentRiskReason: "BASE_RISK", blockNewEntries: true, newlyFailedReason: null, newlyTargetReached: false };
  }

  // Hard stops — most severe first, both FAIL the whole evaluation (spec
  // section 1: daily -5% => FAILED, not just "blocked for today").
  if (totalPnlPct <= account.totalHardPct) {
    return {
      status: "FAILED",
      totalPnlPct,
      dailyPnlPct,
      currentRiskPct: account.baseRiskPct,
      currentRiskReason: "BASE_RISK",
      blockNewEntries: true,
      newlyFailedReason: `TOTAL_HARD_STOP: drawdown total ${totalPnlPct.toFixed(2)}% <= límite ${account.totalHardPct}%`,
      newlyTargetReached: false,
    };
  }
  if (dailyPnlPct !== null && dailyPnlPct <= account.dailyHardPct) {
    return {
      status: "FAILED",
      totalPnlPct,
      dailyPnlPct,
      currentRiskPct: account.baseRiskPct,
      currentRiskReason: "BASE_RISK",
      blockNewEntries: true,
      newlyFailedReason: `DAILY_HARD_STOP: drawdown diario ${dailyPnlPct.toFixed(2)}% <= límite ${account.dailyHardPct}%`,
      newlyTargetReached: false,
    };
  }

  // Target — checked before the softer safety states, since reaching the
  // profit target while technically also inside a drawdown zone should
  // still register as success, not as a risk-reduction state.
  const targetPct = account.phase === "PHASE_1" ? account.phase1TargetPct : account.phase2TargetPct;
  if (totalPnlPct >= targetPct) {
    return { status: "TARGET_REACHED", totalPnlPct, dailyPnlPct, currentRiskPct: account.baseRiskPct, currentRiskReason: "BASE_RISK", blockNewEntries: true, newlyFailedReason: null, newlyTargetReached: true };
  }

  // Soft states — informational/entry-blocking, never terminal.
  const inTotalSafetyZone = totalPnlPct <= account.totalSafetyPct;
  const inDailySafetyZone = dailyPnlPct !== null && dailyPnlPct <= account.dailySafetyPct;

  return {
    status: "ACTIVE",
    totalPnlPct,
    dailyPnlPct,
    currentRiskPct: inTotalSafetyZone ? account.baseRiskPct * 0.5 : account.baseRiskPct,
    currentRiskReason: inTotalSafetyZone ? "TOTAL_DRAWDOWN_PROTECTION" : "BASE_RISK",
    blockNewEntries: inDailySafetyZone,
    newlyFailedReason: null,
    newlyTargetReached: false,
  };
}

/**
 * Spec section 11 — the day boundary is ALWAYS computed in UTC, shifted by
 * `resetHourUtc` hours, never server-local time (which would silently
 * shift day boundaries depending on where this process happens to be
 * deployed). Returns a stable "YYYY-MM-DD" key for "which trading day is
 * `now` in".
 */
export function computeEvaluationDayKey(now: Date, resetHourUtc: number): string {
  const shifted = new Date(now.getTime() - resetHourUtc * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}
