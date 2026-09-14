import { NextResponse } from "next/server";
import { createEvaluationAccount, evaluateCurrentState, getEvaluationAccount } from "@/lib/evaluation/evaluationAccountStore";
import { getConnectionRow } from "@/lib/execution/mt5ConnectionStore";
import type { EvaluationProfileType } from "@/lib/evaluation/evaluationRiskEngine";

/**
 * MT5 Fase 2, spec section 14 — read-only Evaluation Account view for the
 * /accounts UI. Never persists anything: the live totalPnlPct/dailyPnlPct/
 * currentRiskPct/status shown here come from `evaluateCurrentState` (a pure
 * function), while the day-boundary reset and FAILED/TARGET_REACHED
 * persistence stay exclusively on the bot loop's own `syncEvaluationAccount`
 * path (mt5ExecutionOrchestrator.ts's `prepareMt5ScanContext`).
 */
export async function GET() {
  const row = await getEvaluationAccount();
  if (!row) return NextResponse.json({ ok: true, evaluation: null });

  const connectionRow = await getConnectionRow();
  const currentEquity = connectionRow?.equity ?? row.finalEquity ?? row.initialBalance;
  const evalResult = evaluateCurrentState(row, currentEquity);

  return NextResponse.json({
    ok: true,
    evaluation: {
      profileType: row.profileType,
      phase: row.phase,
      initialBalance: row.initialBalance,
      phase1TargetPct: row.phase1TargetPct,
      phase2TargetPct: row.phase2TargetPct,
      baseRiskPct: row.baseRiskPct,
      maxOpenPositions: row.maxOpenPositions,
      maxExposurePct: row.maxExposurePct,
      maxConcentrationPct: row.maxConcentrationPct,
      startedAt: row.startedAt,
      targetReachedAt: row.targetReachedAt,
      daysToTarget: row.daysToTarget,
      failureReason: row.failureReason,
      failedAt: row.failedAt,
      currentEquity,
      status: evalResult.status,
      totalPnlPct: evalResult.totalPnlPct,
      dailyPnlPct: evalResult.dailyPnlPct,
      currentRiskPct: evalResult.currentRiskPct,
      currentRiskReason: evalResult.currentRiskReason,
      blockNewEntries: evalResult.blockNewEntries,
    },
  });
}

/** Starts (or restarts) the Evaluation Account from a profile template — an explicit human action, never automatic. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { profileType, initialBalance, baseRiskPct, minRRR } = body as {
    profileType?: EvaluationProfileType;
    initialBalance?: number;
    baseRiskPct?: number;
    minRRR?: number;
  };

  if (profileType !== "20K" && profileType !== "50K" && profileType !== "100K" && profileType !== "CUSTOM") {
    return NextResponse.json({ ok: false, error: "profileType debe ser 20K, 50K, 100K o CUSTOM." }, { status: 400 });
  }
  if (profileType === "CUSTOM" && (!initialBalance || initialBalance <= 0)) {
    return NextResponse.json({ ok: false, error: "Un perfil CUSTOM requiere initialBalance > 0." }, { status: 400 });
  }

  const row = await createEvaluationAccount(
    profileType,
    profileType === "CUSTOM" ? { initialBalance: initialBalance as number, baseRiskPct, minRRR } : undefined
  );
  return NextResponse.json({ ok: true, evaluation: row });
}
