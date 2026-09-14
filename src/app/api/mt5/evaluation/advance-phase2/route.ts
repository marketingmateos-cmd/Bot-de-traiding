import { NextResponse } from "next/server";
import { advanceToPhase2 } from "@/lib/evaluation/evaluationAccountStore";
import { logAudit } from "@/lib/engines/auditLog";

/** Explicit, human-triggered advancement from a PHASE_1 TARGET_REACHED evaluation into a fresh PHASE_2 evaluation — never automatic (spec section 12). */
export async function POST() {
  try {
    const row = await advanceToPhase2();
    await logAudit({ action: "EVALUATION_ADVANCED_TO_PHASE_2_VIA_UI", entity: "EvaluationAccount", entityId: "main" });
    return NextResponse.json({ ok: true, evaluation: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
