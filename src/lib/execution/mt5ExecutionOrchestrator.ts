import { prisma } from "@/lib/db";
import { checkExposureLimits, type RiskViolationKind } from "@/lib/engines/riskEngine";
import { getEvaluationAccount, syncEvaluationAccount } from "@/lib/evaluation/evaluationAccountStore";
import { evaluateEvaluationAccount, type EvaluationEvalResult } from "@/lib/evaluation/evaluationRiskEngine";
import { getMt5ExecutionAdapter } from "./registry";
import { getConnectionRow, saveConnectionSnapshot, accountInfoToSnapshot } from "./mt5ConnectionStore";
import { verifyMt5ConnectionSafety } from "./mt5ReconnectionGuard";
import { resolveMt5Symbol } from "./mt5SymbolMapper";
import { computeMt5ExposureContext } from "./mt5ExposureContext";
import { calculateMt5PositionSize } from "./mt5PositionSizing";
import { runMt5ExecutionChecklist, type Mt5ExecutionChecklistSignal } from "./executionChecklist";
import { buildIdempotencyKey, hasAlreadyExecuted, type SignalIdentity } from "./duplicateOrderGuard";
import { recordExecutionEvent } from "./executionEventLog";
import { syncMt5Positions } from "./mt5PositionSynchronizer";
import type { OrderSide, TradingExecutionAdapter } from "./types";

/**
 * MT5 Fase 2 — the ONE additive hook `paperTradingEngine.ts` calls. Every
 * function here is a fast no-op unless MT5 demo execution is actually
 * connected AND enabled (spec section 19: "Si está desconectado:
 * Replay/Paper siguen funcionando exactamente igual") — a single cheap
 * read decides that up front, once per scan, never once per candidate.
 */

export interface Mt5ScanContext {
  adapter: TradingExecutionAdapter;
  evaluation: EvaluationEvalResult;
  evaluationThresholds: { dailyHardPct: number; totalHardPct: number; minRRR: number; maxOpenPositions: number; maxExposurePct: number; maxConcentrationPct: number };
}

/**
 * Called ONCE per bot loop scan (mirrors how `runPaperTradingScanExclusive`
 * already computes `riskLimits`/`profitProtection` once, not per
 * candidate). Returns null when MT5 isn't connected+enabled — the caller
 * skips MT5 entirely for this scan in that case, at the cost of exactly
 * one DB read.
 */
export async function prepareMt5ScanContext(now: Date = new Date()): Promise<Mt5ScanContext | null> {
  const connectionRow = await getConnectionRow();
  if (!connectionRow || connectionRow.status !== "CONNECTED" || !connectionRow.executionEnabled) return null;

  const adapter = getMt5ExecutionAdapter();

  // Reconnection Safety (spec section 9) — re-verify the terminal is still
  // reachable and the account is still DEMO on EVERY scan, before trusting
  // anything else this tick. A failure here force-disables execution and
  // returns null — the caller (paperTradingEngine.ts) then simply skips MT5
  // entirely for this scan, exactly as if it had never been connected.
  const safety = await verifyMt5ConnectionSafety(adapter);
  if (!safety.safe) return null;

  // Account Synchronization (spec section 10) — refresh balance/equity/etc
  // from MT5 itself before anything else reads them this scan. Never
  // overwrites the Evaluation account's own configured rules — only the
  // live MT5DemoConnection snapshot fields.
  const accountInfo = await adapter.getAccountInfo();
  if (accountInfo) {
    await saveConnectionSnapshot(accountInfoToSnapshot(accountInfo, connectionRow.verifiedDemo, connectionRow.latencyMs));
  }
  await syncMt5Positions(adapter);

  const evaluationRow = await getEvaluationAccount();
  if (!evaluationRow) return null; // EVALUATION_ACCOUNT_ACTIVE will still be surfaced per-candidate via the checklist's own explicit check

  const currentEquity = accountInfo?.equity ?? evaluationRow.finalEquity ?? evaluationRow.initialBalance;
  const evaluation = await syncEvaluationAccount(currentEquity, now);
  if (!evaluation) return null;

  return {
    adapter,
    evaluation,
    evaluationThresholds: {
      dailyHardPct: evaluationRow.dailyHardPct,
      totalHardPct: evaluationRow.totalHardPct,
      minRRR: evaluationRow.minRRR,
      maxOpenPositions: evaluationRow.maxOpenPositions,
      maxExposurePct: evaluationRow.maxExposurePct,
      maxConcentrationPct: evaluationRow.maxConcentrationPct,
    },
  };
}

export interface Mt5CandidateSignal {
  strategyId: string;
  edgeLabSymbol: string;
  direction: OrderSide;
  signalTimestamp: Date;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tradeGateApproved: boolean; // strict: only a plain APPROVED verdict, never LOW_CONFIDENCE — see docs/mt5-demo-integration.md
  tradeGateBlockedBy: string | null;
}

/**
 * Attempts to place ONE MT5 demo order for a candidate the paper-trading
 * pipeline already evaluated. Never throws — every failure path is a
 * REJECTED/ERROR outcome logged to ExecutionEvent, exactly like a normal
 * checklist rejection, so a bug here can never take down the shared bot
 * loop tick that paper trading also depends on.
 */
export async function attemptMt5DemoExecution(ctx: Mt5ScanContext, signal: Mt5CandidateSignal): Promise<void> {
  try {
    const symbolResolution = await resolveMt5Symbol(signal.edgeLabSymbol, ctx.adapter);

    // Mirrors paperTradingEngine.ts's own `existingPosition` skip — an MT5
    // position already open for this symbol means "this idea already has a
    // real position", never re-entered just because the strategy still
    // likes it on a later tick (idempotencyKey alone only protects a
    // SINGLE attempt from retry/reconnect/restart duplication, not a
    // strategy re-signaling the same idea on a fresh tick).
    if (symbolResolution.ok) {
      const alreadyOpen = await prisma.mt5DemoPosition.findFirst({ where: { symbol: symbolResolution.mt5Symbol } });
      if (alreadyOpen) return;
    }

    const exposure = symbolResolution.ok ? await computeMt5ExposureContext(symbolResolution.mt5Symbol) : { openPositionCount: 0, openNotional: 0, assetOpenNotional: 0 };
    const connectionRow = await getConnectionRow();
    const equity = connectionRow?.equity ?? 0;

    const riskCheck = checkExposureLimits({
      equity,
      openNotional: exposure.openNotional,
      requestedNotional: equity * (ctx.evaluation.currentRiskPct / 100) * 20, // a coarse notional estimate purely for the exposure/concentration ceiling — the REAL, authoritative size comes from calculateMt5PositionSize below, which never exceeds the approved risk regardless of this estimate
      limits: { riskPerTradePct: ctx.evaluation.currentRiskPct, maxExposurePct: ctx.evaluationThresholds.maxExposurePct, maxOpenPositions: ctx.evaluationThresholds.maxOpenPositions, maxDailyLossPct: 100, maxDrawdownPct: 100, maxConcentrationPct: ctx.evaluationThresholds.maxConcentrationPct },
      openPositionCount: exposure.openPositionCount,
      assetOpenNotional: exposure.assetOpenNotional,
      correlatedOpenNotional: 0, // Phase 2 limitation — see mt5ExposureContext.ts
    });

    const symbolSpec = symbolResolution.ok ? await ctx.adapter.getSymbolSpec(symbolResolution.mt5Symbol) : null;
    const positionSizing = symbolSpec
      ? calculateMt5PositionSize({
          accountEquity: equity,
          riskPct: ctx.evaluation.currentRiskPct,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          symbolSpec,
          maxApprovedNotional: riskCheck.passed ? riskCheck.approvedNotional : 0,
        })
      : ({ approved: false, reason: "INVALID_SYMBOL_METADATA", detail: "No se pudo obtener la especificación del símbolo desde MT5." } as const);

    const checklistSignal: Mt5ExecutionChecklistSignal = {
      strategyId: signal.strategyId,
      symbol: signal.edgeLabSymbol,
      signalTimestamp: signal.signalTimestamp,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
    };

    const checklist = runMt5ExecutionChecklist({
      signal: checklistSignal,
      connection: { status: (connectionRow?.status as "CONNECTED" | "DISCONNECTED" | "ERROR") ?? "DISCONNECTED", verifiedDemo: connectionRow?.verifiedDemo ?? false, executionEnabled: connectionRow?.executionEnabled ?? false },
      symbolResolution,
      evaluation: ctx.evaluation,
      evaluationThresholds: { dailyHardPct: ctx.evaluationThresholds.dailyHardPct, totalHardPct: ctx.evaluationThresholds.totalHardPct, minRRR: ctx.evaluationThresholds.minRRR },
      tradeGate: { approved: signal.tradeGateApproved, blockedBy: signal.tradeGateBlockedBy },
      riskCheck: { passed: riskCheck.passed, violationKinds: riskCheck.violationKinds },
      openPositionCount: exposure.openPositionCount,
      maxOpenPositions: ctx.evaluationThresholds.maxOpenPositions,
      positionSizing,
    });

    const signalIdentity: SignalIdentity = { strategyId: signal.strategyId, symbol: signal.edgeLabSymbol, signalTimestamp: signal.signalTimestamp, direction: signal.direction };
    const idempotencyKey = buildIdempotencyKey(signalIdentity);

    if (!checklist.approved) {
      if (await hasAlreadyExecuted(idempotencyKey)) return; // never double-log a rejection for the exact same signal identity either
      await recordExecutionEvent({
        idempotencyKey,
        symbol: signal.edgeLabSymbol,
        side: signal.direction,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        status: "REJECTED",
        rejectionReason: checklist.rejectionReason,
      });
      await prisma.executionEvent.updateMany({ where: { idempotencyKey }, data: { failedCheck: checklist.failedCheck, signalId: idempotencyKey, rrr: checklist.rrr } });
      return;
    }

    if (!symbolResolution.ok || !checklist.approvedVolume) return; // unreachable given checklist.approved, but keeps TS honest and this function crash-proof

    // A real execution attempt for this EXACT signal identity already
    // happened (retry/reconnect/restart/UI refresh) — never call the
    // adapter again and, critically, never touch that row below. Without
    // this early return, the adapter's OWN duplicate guard would still
    // correctly refuse the second `placeOrder` call, but its REJECTED
    // result would then flow into the enrichment write below and silently
    // overwrite a possibly-FILLED order's status with FAILED_EXECUTION.
    if (await hasAlreadyExecuted(idempotencyKey)) return;

    const result = await ctx.adapter.placeOrder({
      symbol: symbolResolution.mt5Symbol,
      side: signal.direction,
      volume: checklist.approvedVolume,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      idempotencyKey,
    });

    // adapter.placeOrder already records its own ExecutionEvent (Fase 1) —
    // this just enriches THAT same row with the checklist's own audit
    // fields, which the adapter has no way to know about. Spec section 7:
    // an order that cleared all 15 checks but MT5 itself then rejected/
    // errored on is a DIFFERENT situation from a pre-flight REJECTED (never
    // even sent) — relabelled FAILED_EXECUTION so the audit trail can tell
    // the two apart. Never a fictitious FILLED position either way: only
    // the branch below, gated on the adapter's own result, ever syncs
    // positions from MT5's real response. `symbol` is normalized back to
    // the EdgeLab symbol here — the adapter logs its own row under the MT5
    // broker symbol (it only ever sees `PlaceOrderRequest`, not the
    // original signal), which would otherwise make the SAME EdgeLab symbol
    // show up under two different names in the log depending on whether
    // the checklist rejected it (EdgeLab symbol) or the adapter placed it
    // (broker symbol) — always the EdgeLab symbol here, since that's the
    // one name available on every row regardless of outcome.
    await prisma.executionEvent.updateMany({
      where: { idempotencyKey },
      data: {
        symbol: signal.edgeLabSymbol,
        signalId: idempotencyKey,
        rrr: checklist.rrr,
        riskAmount: checklist.riskAmount,
        status: result.status === "FILLED" ? undefined : "FAILED_EXECUTION",
      },
    });

    if (result.status === "FILLED") {
      await syncMt5Positions(ctx.adapter);
    }
  } catch (err) {
    // Never let an MT5 execution bug take down the shared bot loop tick
    // that paper trading also depends on — log it as an ERROR execution
    // event and move on, exactly like any other rejection.
    const message = err instanceof Error ? err.message : String(err);
    await recordExecutionEvent({ symbol: signal.edgeLabSymbol, side: signal.direction, status: "ERROR", rejectionReason: message }).catch(() => {});
  }
}
