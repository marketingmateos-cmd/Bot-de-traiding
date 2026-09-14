/**
 * Presentation-layer translations (English → Spanish) for display only.
 * The underlying enum values stored in the database and used in engine
 * logic (regimes, verdicts, statuses, etc.) stay in English on purpose —
 * changing them would touch the Prisma schema, the Trade Gate, and every
 * engine that branches on them. These helpers translate ONLY what's shown
 * to the user.
 */

export function tRegime(regime: string): string {
  const map: Record<string, string> = {
    STRONG_BULL: "ALCISTA FUERTE",
    BULL: "ALCISTA",
    NEUTRAL: "NEUTRAL",
    BEAR: "BAJISTA",
    STRONG_BEAR: "BAJISTA FUERTE",
    HIGH_VOLATILITY: "ALTA VOLATILIDAD",
    LOW_VOLATILITY: "BAJA VOLATILIDAD",
    RANGE: "LATERAL (RANGO)",
    TRANSITION: "TRANSICIÓN",
  };
  return map[regime] ?? regime;
}

export function tVerdict(verdict: string): string {
  const map: Record<string, string> = {
    APPROVED: "APROBADO",
    LOW_CONFIDENCE: "BAJA CONFIANZA",
    BLOCKED: "BLOQUEADO",
    NO_SIGNAL: "SIN SEÑAL",
    ROBUST: "ROBUSTA",
    PROMISING: "PROMETEDORA",
    INSUFFICIENT_EVIDENCE: "EVIDENCIA INSUFICIENTE",
    ACCEPTED: "ACEPTADA",
    REJECTED: "RECHAZADA",
    PROPOSED: "PROPUESTA",
    TESTING: "EN PRUEBA",
  };
  return map[verdict] ?? verdict;
}

export function tDirection(direction: string): string {
  return direction === "LONG" ? "LARGO" : direction === "SHORT" ? "CORTO" : direction;
}

export function tRiskProfile(profile: string): string {
  const map: Record<string, string> = {
    CONSERVATIVE: "CONSERVADOR",
    BALANCED: "EQUILIBRADO",
    AGGRESSIVE: "AGRESIVO",
    VERY_AGGRESSIVE: "MUY AGRESIVO",
    CUSTOM: "PERSONALIZADO",
  };
  return map[profile] ?? profile;
}

export function tExitReason(reason: string): string {
  const map: Record<string, string> = {
    STOP_LOSS: "STOP LOSS",
    TAKE_PROFIT: "TAKE PROFIT",
    TRAILING_STOP: "STOP DINÁMICO",
    SIGNAL: "SEÑAL",
    MANUAL: "MANUAL",
    RISK: "RIESGO",
    CIRCUIT_BREAKER: "CORTAFUEGOS",
  };
  return map[reason] ?? reason;
}

export function tPostMortem(classification: string): string {
  const map: Record<string, string> = {
    GOOD_EXECUTION: "BUENA EJECUCIÓN",
    BAD_EXECUTION: "MALA EJECUCIÓN",
    GOOD_IDEA_BAD_RESULT: "BUENA IDEA, MAL RESULTADO",
    BAD_IDEA_GOOD_RESULT: "MALA IDEA, BUEN RESULTADO (SUERTE)",
    INSUFFICIENT_DATA: "DATOS INSUFICIENTES",
    ANOMALY: "ANOMALÍA",
  };
  return map[classification] ?? classification;
}

export function tOrderStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: "PENDIENTE",
    FILLED: "EJECUTADA",
    REJECTED: "RECHAZADA",
    CANCELLED: "CANCELADA",
    LOW_CONFIDENCE: "BAJA CONFIANZA",
  };
  return map[status] ?? status;
}

export function tPositionStatus(status: string): string {
  const map: Record<string, string> = {
    FLAT: "SIN POSICIÓN",
    PENDING: "PENDIENTE",
    OPEN: "ABIERTA",
    PARTIALLY_CLOSED: "PARCIALMENTE CERRADA",
    CLOSED: "CERRADA",
    ERROR: "ERROR",
  };
  return map[status] ?? status;
}

export function tSeverity(severity: string): string {
  const map: Record<string, string> = { INFO: "INFO", WARN: "AVISO", CRITICAL: "CRÍTICO" };
  return map[severity] ?? severity;
}

export function tNewsCategory(category: string): string {
  const map: Record<string, string> = {
    MACRO: "MACRO",
    REGULATION: "REGULACIÓN",
    EXCHANGE: "EXCHANGE",
    PROTOCOL: "PROTOCOLO",
    ETF: "ETF",
    SECURITY: "SEGURIDAD",
    ADOPTION: "ADOPCIÓN",
    PARTNERSHIP: "ALIANZA",
    TECHNOLOGY: "TECNOLOGÍA",
    MARKET: "MERCADO",
    OTHER: "OTRA",
  };
  return map[category] ?? category;
}

export function tStrategyKind(kind: string): string {
  const map: Record<string, string> = {
    TREND_FOLLOWING: "SEGUIMIENTO DE TENDENCIA",
    MOMENTUM: "MOMENTUM",
    BREAKOUT: "RUPTURA",
    MEAN_REVERSION: "REVERSIÓN A LA MEDIA",
    VOLATILITY: "VOLATILIDAD",
    MULTI_TIMEFRAME: "MULTI-TEMPORALIDAD",
    EVENT_DRIVEN: "DIRIGIDA POR EVENTOS",
    VOLATILITY_SQUEEZE: "COMPRESIÓN DE VOLATILIDAD",
    VOLUME_CONFIRMATION: "CONFIRMACIÓN POR VOLUMEN",
    TREND_PULLBACK: "RETROCESO EN TENDENCIA",
    BREAKOUT_CONFIRMATION: "RUPTURA CONFIRMADA",
    MOMENTUM_REVERSAL: "REVERSIÓN POR AGOTAMIENTO",
  };
  return map[kind] ?? kind.replace(/_/g, " ");
}

export function tGateStep(name: string): string {
  const map: Record<string, string> = {
    DATA_CHECK: "CALIDAD DE DATOS",
    MARKET_CHECK: "MERCADO",
    REGIME_CHECK: "RÉGIMEN",
    STRATEGY_CHECK: "ESTRATEGIA",
    NEWS_CHECK: "NOTICIAS",
    SENTIMENT_CHECK: "SENTIMIENTO",
    ONCHAIN_CHECK: "ON-CHAIN",
    AI_ANALYST: "IA ANALISTA",
    AI_CRITIC: "IA CRÍTICA",
    RISK_CHECK: "RIESGO",
    ROBUSTNESS_CHECK: "ROBUSTEZ",
  };
  return map[name] ?? name.replace(/_/g, " ");
}

export function tEvidenceLevel(level: string): string {
  const map: Record<string, string> = { LOW: "BAJA", MEDIUM: "MEDIA", HIGH: "ALTA" };
  return map[level] ?? level;
}
