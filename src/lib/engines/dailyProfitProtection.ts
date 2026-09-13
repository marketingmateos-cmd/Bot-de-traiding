import { prisma } from "@/lib/db";
import type { EvidenceLevel } from "./luckVsEdge";
import type { GateVerdict } from "./tradeGate";

/** Persistent, single-source-of-truth config — mirrors ensureBotConfig in botLoop.ts. Editable from Settings. */
export async function ensureProfitProtectionConfig(accountId = "main-paper-account") {
  return prisma.profitProtectionConfig.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main", accountId },
  });
}

export function toEvidenceLevel(value: string): EvidenceLevel {
  return value === "HIGH" || value === "MEDIUM" ? value : "LOW";
}

/**
 * Daily Profit Protection (Fase 6). A state machine driven ONLY by real,
 * measured numbers — the account's own realized+unrealized P&L today
 * against its own start-of-day equity — never by an AI opinion:
 *
 *   NORMAL             — trading proceeds as usual.
 *   PROFIT_PROTECTION  — today's gains are worth protecting; new trades are
 *                        blocked UNLESS they clear the quantitative
 *                        "exceptional opportunity" bar below. Open
 *                        positions are still managed (stops/targets) in
 *                        every state — protecting profit never means
 *                        abandoning risk management on what's already open.
 *   HARD_DAILY_STOP    — today's losses hit the hard floor: NO new trades,
 *                        no exception, full stop for new risk. Open
 *                        positions still get managed.
 */
export type ProfitProtectionState = "NORMAL" | "PROFIT_PROTECTION" | "HARD_DAILY_STOP";

export interface ProfitProtectionConfigLike {
  isEnabled: boolean;
  profitProtectionTriggerPct: number;
  hardStopLossPct: number;
  exceptionalMinConfidence: number;
  exceptionalMinEvidenceLevel: EvidenceLevel;
  exceptionalSizeMultiplier: number;
}

export interface ProfitProtectionEvaluation {
  state: ProfitProtectionState;
  dailyPnlPct: number;
  reason: string;
}

/**
 * Evaluates the state from real numbers only: current equity (realized
 * cash + unrealized P&L on open positions) against the account's own
 * equity at the start of today (UTC). `hardStopLossPct` is expected to be
 * negative (e.g. -5 for "-5%"); `profitProtectionTriggerPct` positive.
 */
export function evaluateProfitProtection(input: {
  startOfDayEquity: number;
  currentEquity: number;
  config: ProfitProtectionConfigLike;
}): ProfitProtectionEvaluation {
  const dailyPnlPct = input.startOfDayEquity > 0 ? ((input.currentEquity - input.startOfDayEquity) / input.startOfDayEquity) * 100 : 0;

  if (!input.config.isEnabled) {
    return { state: "NORMAL", dailyPnlPct, reason: "Daily Profit Protection está desactivada en la configuración." };
  }

  if (dailyPnlPct <= input.config.hardStopLossPct) {
    return {
      state: "HARD_DAILY_STOP",
      dailyPnlPct,
      reason: `El P&L de hoy (${dailyPnlPct.toFixed(2)}%) alcanzó el límite de parada dura (${input.config.hardStopLossPct}%). No se abrirán nuevas operaciones hoy — las posiciones abiertas se siguen gestionando.`,
    };
  }

  if (dailyPnlPct >= input.config.profitProtectionTriggerPct) {
    return {
      state: "PROFIT_PROTECTION",
      dailyPnlPct,
      reason: `El P&L de hoy (${dailyPnlPct.toFixed(2)}%) alcanzó el umbral de protección de beneficios (${input.config.profitProtectionTriggerPct}%). Solo se permiten oportunidades excepcionales, verificadas cuantitativamente.`,
    };
  }

  return { state: "NORMAL", dailyPnlPct, reason: `P&L de hoy (${dailyPnlPct.toFixed(2)}%) dentro de rangos normales.` };
}

export interface ExceptionalOpportunityInput {
  config: ProfitProtectionConfigLike;
  aiAnalystConfidence: number;
  aiAnalystRecommendation: "APPROVE" | "LOW_CONFIDENCE" | "REJECT";
  aiCriticVerdict: "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED";
  evidenceLevel: EvidenceLevel;
  /** The Trade Gate's verdict computed WITHOUT this Daily Profit Protection check — must already be a clean APPROVED, never a downgrade. */
  gateVerdictWithoutProfitProtection: GateVerdict;
}

export interface ExceptionalOpportunityResult {
  isExceptional: boolean;
  reasons: string[];
}

export interface ProfitProtectionStatus extends ProfitProtectionEvaluation {
  config: ProfitProtectionConfigLike;
}

/**
 * Read-only status computation shared by the Dashboard and Settings pages —
 * same real-numbers math `runPaperTradingScan` uses to drive the state
 * machine (see paperTradingEngine.ts), so the UI never shows a different
 * answer than what actually gated the last scan. Kept separate from the
 * scan's own inline computation there since the scan already has
 * account/trades/positions loaded for other reasons; this re-fetches them
 * for a standalone read (e.g. rendering a page) where nothing else needs them.
 */
export async function computeProfitProtectionStatus(accountId: string): Promise<ProfitProtectionStatus> {
  const account = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const allTrades = await prisma.trade.findMany({ where: { accountId }, orderBy: { closedAt: "asc" } });
  const startOfDayEquity = account.startingBalance + allTrades.filter((t) => t.closedAt < todayStart).reduce((s, t) => s + t.netPnl, 0);
  const openPositions = await prisma.paperPosition.findMany({ where: { accountId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } } });
  const unrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);

  const configRow = await ensureProfitProtectionConfig(accountId);
  const config: ProfitProtectionConfigLike = {
    isEnabled: configRow.isEnabled,
    profitProtectionTriggerPct: configRow.profitProtectionTriggerPct,
    hardStopLossPct: configRow.hardStopLossPct,
    exceptionalMinConfidence: configRow.exceptionalMinConfidence,
    exceptionalMinEvidenceLevel: toEvidenceLevel(configRow.exceptionalMinEvidenceLevel),
    exceptionalSizeMultiplier: configRow.exceptionalSizeMultiplier,
  };
  const evaluation = evaluateProfitProtection({ startOfDayEquity, currentEquity: account.cashBalance + unrealizedPnl, config });
  return { ...evaluation, config };
}

const EVIDENCE_RANK: Record<EvidenceLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * The ONLY way a new trade proceeds while in PROFIT_PROTECTION. Every
 * criterion here is a plain number or an already-computed, independently
 * verifiable status — never "ask the AI if this is good" on its own. All
 * conditions must hold (AND, not OR): a high AI confidence number alone is
 * not suficient without also having a genuine track record (evidenceLevel)
 * and a fully clean Trade Gate result (no other check downgraded or
 * blocked it).
 */
export function checkExceptionalOpportunity(input: ExceptionalOpportunityInput): ExceptionalOpportunityResult {
  const reasons: string[] = [];

  if (input.gateVerdictWithoutProfitProtection !== "APPROVED") {
    reasons.push(`El resto del Trade Gate no dio un veredicto APPROVED limpio (fue ${input.gateVerdictWithoutProfitProtection}) — una oportunidad excepcional exige que todo lo demás ya sea impecable.`);
  }
  if (input.aiAnalystRecommendation !== "APPROVE") {
    reasons.push(`La IA Analista no recomienda APPROVE (${input.aiAnalystRecommendation}).`);
  }
  if (input.aiCriticVerdict !== "APPROVED") {
    reasons.push(`La IA Crítica no dio APPROVED (${input.aiCriticVerdict}).`);
  }
  if (input.aiAnalystConfidence < input.config.exceptionalMinConfidence) {
    reasons.push(`La confianza de la IA Analista (${(input.aiAnalystConfidence * 100).toFixed(0)}%) no alcanza el mínimo exigido (${(input.config.exceptionalMinConfidence * 100).toFixed(0)}%).`);
  }
  if (EVIDENCE_RANK[input.evidenceLevel] < EVIDENCE_RANK[input.config.exceptionalMinEvidenceLevel]) {
    reasons.push(`El nivel de evidencia histórica (${input.evidenceLevel}) no alcanza el mínimo exigido (${input.config.exceptionalMinEvidenceLevel}) — sin un historial real y verificable no hay excepción posible.`);
  }

  return { isExceptional: reasons.length === 0, reasons };
}
