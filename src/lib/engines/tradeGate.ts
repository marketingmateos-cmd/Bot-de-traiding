import type { DataQualityReport } from "./dataQuality";
import type { Regime, RegimeResult } from "./regime";
import { isRegimeCompatible } from "./regime";
import type { StrategySignal } from "./strategy/types";
import type { NewsSummary } from "./news";
import type { SentimentAnalysis } from "./sentiment";
import type { OnChainMetricResult } from "@/lib/providers/types";
import type { AIAnalystOutput, AICriticOutput } from "@/lib/providers/types";
import type { RiskCheckResult } from "./riskEngine";
import type { LuckVsEdgeAssessment } from "./luckVsEdge";
import { checkExceptionalOpportunity, type ProfitProtectionConfigLike, type ProfitProtectionState } from "./dailyProfitProtection";

export type GateVerdict = "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED";

export interface GateStep {
  name:
    | "DATA_CHECK"
    | "MARKET_CHECK"
    | "REGIME_CHECK"
    | "STRATEGY_CHECK"
    | "NEWS_CHECK"
    | "SENTIMENT_CHECK"
    | "ONCHAIN_CHECK"
    | "AI_ANALYST"
    | "AI_CRITIC"
    | "RISK_CHECK"
    | "ROBUSTNESS_CHECK"
    | "DAILY_PROFIT_PROTECTION";
  passed: boolean;
  downgrade: boolean; // true = doesn't block outright but forces LOW_CONFIDENCE
  detail: string;
}

export interface TradeGateInput {
  dataQuality: DataQualityReport;
  marketHealthy: boolean; // e.g. latest price reachable
  regime: RegimeResult;
  /** The strategy VERSION's own declared recommended regimes — the single source of truth for regime gating. */
  recommendedRegimes: Regime[];
  strategySignal: StrategySignal | null;
  news: NewsSummary;
  sentiment: SentimentAnalysis;
  onChain: OnChainMetricResult[];
  aiAnalyst: AIAnalystOutput;
  aiCritic: AICriticOutput;
  risk: RiskCheckResult;
  circuitBreakerTripped: boolean;
  circuitBreakerReasons: string[];
  robustness: LuckVsEdgeAssessment;
  /**
   * Fase 6 — Daily Profit Protection. `null` when the feature doesn't apply
   * to this evaluation (e.g. backtesting, which has its own separate P&L
   * framing) — in that case the step passes unconditionally.
   */
  dailyProfitProtection: {
    state: ProfitProtectionState;
    config: ProfitProtectionConfigLike;
  } | null;
}

export interface TradeGateResult {
  verdict: GateVerdict;
  blockedBy: string | null;
  steps: GateStep[];
}

/**
 * Trade Gate (spec §18) — the ONLY path from "a strategy has an idea" to "a
 * simulated order is placed". Runs all 12 checks every time (never
 * short-circuits) so the full audit trail is always available, then derives
 * a verdict: any failed non-downgrade step BLOCKS; any downgrade-only issue
 * caps the verdict at LOW_CONFIDENCE. The 12th (DAILY_PROFIT_PROTECTION,
 * Fase 6) is derived from the other 11's own intermediate verdict, so it
 * never short-circuits ahead of them either.
 */
export function runTradeGate(input: TradeGateInput): TradeGateResult {
  const steps: GateStep[] = [];

  steps.push({
    name: "DATA_CHECK",
    passed: !input.dataQuality.blocksTrading,
    downgrade: false,
    detail: input.dataQuality.blocksTrading
      ? `La calidad de datos (${input.dataQuality.score}) está por debajo del mínimo requerido para operar.`
      : `Calidad de datos: ${input.dataQuality.score}/100.`,
  });

  steps.push({
    name: "MARKET_CHECK",
    passed: input.marketHealthy,
    downgrade: false,
    detail: input.marketHealthy ? "El feed de datos de mercado funciona correctamente." : "El feed de datos de mercado no está disponible o está desactualizado.",
  });

  const regimeOk = isRegimeCompatible(input.recommendedRegimes, input.regime.regime);
  steps.push({
    name: "REGIME_CHECK",
    passed: regimeOk,
    downgrade: false,
    detail: regimeOk
      ? `El régimen ${input.regime.regime} es compatible con los regímenes recomendados de esta versión de estrategia.`
      : `El régimen ${input.regime.regime} NO está entre los regímenes recomendados de esta versión de estrategia (${input.recommendedRegimes.join(", ")}).`,
  });

  const hasSignal = input.strategySignal !== null;
  steps.push({
    name: "STRATEGY_CHECK",
    passed: hasSignal,
    downgrade: false,
    detail: hasSignal ? `La estrategia generó una señal ${input.strategySignal!.direction}: ${input.strategySignal!.reason}` : "No hay ninguna señal de estrategia presente.",
  });

  const newsBlocking = input.news.topStories.some((n) => n.category === "SECURITY" && n.sentiment < -0.6 && n.impactScore > 70);
  steps.push({
    name: "NEWS_CHECK",
    passed: !newsBlocking,
    downgrade: !newsBlocking && input.news.score < 35,
    detail: newsBlocking
      ? "Se encontró una noticia de seguridad de alto impacto y fuertemente negativa."
      : `Puntuación del componente de noticias: ${input.news.score}/100.`,
  });

  steps.push({
    name: "SENTIMENT_CHECK",
    passed: true,
    downgrade: input.sentiment.divergence,
    detail: input.sentiment.divergence
      ? "Divergencia sentimiento/precio detectada — confianza rebajada."
      : `Puntuación de sentimiento: ${input.sentiment.score}/100, tendencia ${input.sentiment.trend.toFixed(3)}.`,
  });

  const onChainAvailable = input.onChain.filter((m) => m.available).length;
  steps.push({
    name: "ONCHAIN_CHECK",
    passed: true,
    downgrade: onChainAvailable === 0,
    detail: onChainAvailable > 0 ? `${onChainAvailable} métrica(s) on-chain disponible(s).` : "No hay datos on-chain disponibles para este activo — DATOS NO DISPONIBLES.",
  });

  const analystOk = input.aiAnalyst.recommendation !== "REJECT";
  steps.push({
    name: "AI_ANALYST",
    passed: analystOk,
    downgrade: input.aiAnalyst.recommendation === "LOW_CONFIDENCE",
    detail: `La IA Analista recomienda ${input.aiAnalyst.recommendation} (confianza ${(input.aiAnalyst.confidence * 100).toFixed(0)}%).`,
  });

  const criticOk = input.aiCritic.verdict !== "BLOCKED";
  steps.push({
    name: "AI_CRITIC",
    passed: criticOk,
    downgrade: input.aiCritic.verdict === "LOW_CONFIDENCE",
    detail: `Veredicto de la IA Crítica: ${input.aiCritic.verdict}.${input.aiCritic.challengedReasons.length ? " Objeciones: " + input.aiCritic.challengedReasons.join("; ") : ""}`,
  });

  const riskOk = input.risk.passed && !input.circuitBreakerTripped;
  steps.push({
    name: "RISK_CHECK",
    passed: riskOk,
    downgrade: false,
    detail: input.circuitBreakerTripped
      ? `Cortafuegos activado(s): ${input.circuitBreakerReasons.join(", ")}`
      : input.risk.passed
      ? `Exposición proyectada ${input.risk.exposurePctAfter.toFixed(1)}% dentro de los límites.`
      : input.risk.violations.join(" "),
  });

  steps.push({
    name: "ROBUSTNESS_CHECK",
    // Never an outright block: a brand-new strategy version has zero trades
    // by definition, and it has to be allowed to trade cautiously (as
    // LOW_CONFIDENCE) to ever accumulate the evidence this check wants —
    // otherwise no strategy could ever bootstrap real performance history.
    passed: true,
    downgrade: input.robustness.evidenceLevel === "LOW",
    detail: `Nivel de evidencia: ${input.robustness.evidenceLevel}. ${input.robustness.warnings.join(" ")}`,
  });

  // Fase 6 — Daily Profit Protection. Computed from the OTHER 11 checks'
  // own intermediate verdict (never circular: this step never looks at
  // itself), since the "exceptional opportunity" exception requires that
  // verdict to already be a clean APPROVED — see dailyProfitProtection.ts.
  const preProtectionFailed = steps.find((s) => !s.passed);
  const preProtectionDowngrade = steps.find((s) => s.downgrade);
  const preProtectionVerdict: GateVerdict = preProtectionFailed ? "BLOCKED" : preProtectionDowngrade ? "LOW_CONFIDENCE" : "APPROVED";

  if (input.dailyProfitProtection === null || input.dailyProfitProtection.state === "NORMAL") {
    steps.push({
      name: "DAILY_PROFIT_PROTECTION",
      passed: true,
      downgrade: false,
      detail: input.dailyProfitProtection === null ? "Daily Profit Protection no aplica a esta evaluación." : "Estado NORMAL — sin restricciones adicionales.",
    });
  } else if (input.dailyProfitProtection.state === "HARD_DAILY_STOP") {
    steps.push({
      name: "DAILY_PROFIT_PROTECTION",
      passed: false,
      downgrade: false, // hard stop — never just a confidence haircut, no exception exists for this state
      detail: "HARD_DAILY_STOP: se alcanzó el límite de pérdida diaria — no se abren nuevas operaciones hoy bajo ninguna circunstancia.",
    });
  } else {
    // PROFIT_PROTECTION: blocked unless the quantitative "exceptional
    // opportunity" bar is cleared — see checkExceptionalOpportunity's own
    // doc comment for why this can never reduce to "the AI says it's good".
    const exceptional = checkExceptionalOpportunity({
      config: input.dailyProfitProtection.config,
      aiAnalystConfidence: input.aiAnalyst.confidence,
      aiAnalystRecommendation: input.aiAnalyst.recommendation,
      aiCriticVerdict: input.aiCritic.verdict,
      evidenceLevel: input.robustness.evidenceLevel,
      gateVerdictWithoutProfitProtection: preProtectionVerdict,
    });
    steps.push({
      name: "DAILY_PROFIT_PROTECTION",
      passed: exceptional.isExceptional,
      downgrade: false,
      detail: exceptional.isExceptional
        ? "PROFIT_PROTECTION activo, pero esta señal supera el listón cuantitativo de 'oportunidad excepcional' — se permite a tamaño reducido."
        : `PROFIT_PROTECTION activo — señal bloqueada por no ser una oportunidad excepcional verificable: ${exceptional.reasons.join(" ")}`,
    });
  }

  const failedStep = steps.find((s) => !s.passed);
  const downgradeStep = steps.find((s) => s.downgrade);

  let verdict: GateVerdict = "APPROVED";
  let blockedBy: string | null = null;
  if (failedStep) {
    verdict = "BLOCKED";
    blockedBy = failedStep.name;
  } else if (downgradeStep) {
    verdict = "LOW_CONFIDENCE";
    blockedBy = downgradeStep.name;
  }

  return { verdict, blockedBy, steps };
}
