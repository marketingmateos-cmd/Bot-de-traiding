import { prisma } from "@/lib/db";
import { createSystemAlert } from "@/lib/engines/alerts";
import { logAudit } from "@/lib/engines/auditLog";
import { computeEvaluationDayKey, evaluateEvaluationAccount, resolveEvaluationTemplate, type EvaluationAccountState, type EvaluationEvalResult, type EvaluationPhase, type EvaluationProfileTemplate, type EvaluationProfileType } from "./evaluationRiskEngine";

const SINGLETON_ID = "main";

export async function getEvaluationAccount() {
  return prisma.evaluationAccount.findUnique({ where: { id: SINGLETON_ID } });
}

/** Starts (or restarts) the evaluation from a template — an explicit, deliberate action, never automatic. */
export async function createEvaluationAccount(profileType: EvaluationProfileType, custom?: Partial<EvaluationProfileTemplate> & { initialBalance: number }) {
  const template = resolveEvaluationTemplate(profileType, custom);
  const row = await prisma.evaluationAccount.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      profileType: template.profileType,
      initialBalance: template.initialBalance,
      phase: "PHASE_1",
      phase1TargetPct: template.phase1TargetPct,
      phase2TargetPct: template.phase2TargetPct,
      dailySafetyPct: template.dailySafetyPct,
      dailyHardPct: template.dailyHardPct,
      totalSafetyPct: template.totalSafetyPct,
      totalHardPct: template.totalHardPct,
      baseRiskPct: template.baseRiskPct,
      minRRR: template.minRRR,
      status: "ACTIVE",
    },
    update: {
      profileType: template.profileType,
      initialBalance: template.initialBalance,
      phase: "PHASE_1",
      phase1TargetPct: template.phase1TargetPct,
      phase2TargetPct: template.phase2TargetPct,
      dailySafetyPct: template.dailySafetyPct,
      dailyHardPct: template.dailyHardPct,
      totalSafetyPct: template.totalSafetyPct,
      totalHardPct: template.totalHardPct,
      baseRiskPct: template.baseRiskPct,
      minRRR: template.minRRR,
      status: "ACTIVE",
      dayStartDate: null,
      dayStartEquity: null,
      targetReachedAt: null,
      daysToTarget: null,
      finalEquity: null,
      finalBalance: null,
      failureReason: null,
      failedAt: null,
      startedAt: new Date(),
    },
  });
  await logAudit({ action: "EVALUATION_ACCOUNT_STARTED", entity: "EvaluationAccount", entityId: SINGLETON_ID, data: { profileType, initialBalance: template.initialBalance } });
  return row;
}

function toState(row: NonNullable<Awaited<ReturnType<typeof getEvaluationAccount>>>): EvaluationAccountState {
  return {
    initialBalance: row.initialBalance,
    phase: row.phase as EvaluationPhase,
    phase1TargetPct: row.phase1TargetPct,
    phase2TargetPct: row.phase2TargetPct,
    dailySafetyPct: row.dailySafetyPct,
    dailyHardPct: row.dailyHardPct,
    totalSafetyPct: row.totalSafetyPct,
    totalHardPct: row.totalHardPct,
    baseRiskPct: row.baseRiskPct,
    minRRR: row.minRRR,
    status: row.status as EvaluationAccountState["status"],
    dayStartEquity: row.dayStartEquity,
  };
}

/**
 * Read-only view for the UI/API layer (spec section 14) — evaluates the
 * CURRENT persisted account against a given equity reading WITHOUT writing
 * anything (no day-reset, no FAILED/TARGET_REACHED persistence, no alerts).
 * Safe to call on every page load; `syncEvaluationAccount` below remains
 * the ONLY path that actually persists state, called once per bot loop tick.
 */
export function evaluateCurrentState(row: NonNullable<Awaited<ReturnType<typeof getEvaluationAccount>>>, currentEquity: number): EvaluationEvalResult {
  return evaluateEvaluationAccount({ account: toState(row), currentEquity });
}

/**
 * Called once per bot loop tick (spec section 10) with the CURRENT MT5
 * equity reading. Handles the day-boundary reset (section 11), evaluates
 * the account (evaluationRiskEngine.ts), persists any FRESH transition
 * into FAILED/TARGET_REACHED exactly once (never re-fires an alert every
 * cycle spent in the same terminal state — same pattern as
 * dailyProfitProtection.ts), and advances to PHASE_2 automatically the
 * moment PHASE_1's target is reached... except spec section 12 says target
 * reached blocks new entries outright rather than rolling into Phase 2
 * automatically, so phase advancement is a SEPARATE, explicit action (see
 * advanceToPhase2 below) — this function only ever reports/persists
 * ACTIVE/TARGET_REACHED/FAILED for the phase it's currently on.
 */
export async function syncEvaluationAccount(currentEquity: number, now: Date = new Date()): Promise<EvaluationEvalResult | null> {
  const row = await getEvaluationAccount();
  if (!row) return null; // no evaluation configured — nothing to do, never fabricated

  const dayKey = computeEvaluationDayKey(now, row.resetHourUtc);
  let dayStartEquity = row.dayStartEquity;
  if (row.dayStartDate !== dayKey) {
    dayStartEquity = currentEquity;
    await prisma.evaluationAccount.update({ where: { id: SINGLETON_ID }, data: { dayStartDate: dayKey, dayStartEquity } });
  }

  const state = toState({ ...row, dayStartEquity });
  const result = evaluateEvaluationAccount({ account: state, currentEquity });

  if (result.newlyFailedReason) {
    const totalTrades = await prisma.executionEvent.count({ where: { status: "FILLED", createdAt: { gte: row.startedAt } } });
    await prisma.evaluationAccount.update({
      where: { id: SINGLETON_ID },
      data: { status: "FAILED", failureReason: result.newlyFailedReason, failedAt: now, finalEquity: currentEquity, finalBalance: currentEquity },
    });
    await createSystemAlert({ kind: "EVALUATION_FAILED", severity: "CRITICAL", title: "Evaluation FAILED", message: result.newlyFailedReason });
    await logAudit({ action: "EVALUATION_FAILED", entity: "EvaluationAccount", entityId: SINGLETON_ID, data: { reason: result.newlyFailedReason, totalTrades, currentEquity } });
  } else if (result.newlyTargetReached) {
    const totalTrades = await prisma.executionEvent.count({ where: { status: "FILLED", createdAt: { gte: row.startedAt } } });
    const daysToTarget = Math.max(1, Math.round((now.getTime() - row.startedAt.getTime()) / 86_400_000));
    await prisma.evaluationAccount.update({
      where: { id: SINGLETON_ID },
      data: { status: "TARGET_REACHED", targetReachedAt: now, daysToTarget, finalEquity: currentEquity, finalBalance: currentEquity },
    });
    await createSystemAlert({
      kind: "EVALUATION_TARGET_REACHED",
      severity: "INFO",
      title: `Evaluation ${row.phase}: TARGET_REACHED`,
      message: `Equity final ${currentEquity.toFixed(2)}, ${totalTrades} operación(es), ${daysToTarget} día(s).`,
    });
    await logAudit({ action: "EVALUATION_TARGET_REACHED", entity: "EvaluationAccount", entityId: SINGLETON_ID, data: { phase: row.phase, totalTrades, daysToTarget, currentEquity } });
  }

  return result;
}

/** Explicit, human-triggered advancement from a PHASE_1 TARGET_REACHED evaluation into a fresh PHASE_2 evaluation — never automatic. */
export async function advanceToPhase2() {
  const row = await getEvaluationAccount();
  if (!row) throw new Error("No hay una evaluación activa.");
  if (row.status !== "TARGET_REACHED" || row.phase !== "PHASE_1") {
    throw new Error("Solo se puede avanzar a PHASE_2 desde una evaluación PHASE_1 con status TARGET_REACHED.");
  }
  const updated = await prisma.evaluationAccount.update({
    where: { id: SINGLETON_ID },
    data: {
      phase: "PHASE_2",
      status: "ACTIVE",
      initialBalance: row.finalBalance ?? row.initialBalance,
      dayStartDate: null,
      dayStartEquity: null,
      targetReachedAt: null,
      daysToTarget: null,
      finalEquity: null,
      finalBalance: null,
      startedAt: new Date(),
    },
  });
  await logAudit({ action: "EVALUATION_ADVANCED_TO_PHASE_2", entity: "EvaluationAccount", entityId: SINGLETON_ID });
  return updated;
}
