import { FROZEN_DATASET, FROZEN_RANGES, FROZEN_WALK_FORWARD_OPTIONS } from "./phase18PreRegistration";
import { FROZEN_STRESS_SCENARIOS, FROZEN_EVALUATION_PROFILE, RUIN_THRESHOLD_PCT, RETURN_THRESHOLDS_PCT, DRAWDOWN_THRESHOLDS_PCT, FROZEN_PHASE18_REPLAY_RUN_IDS, SEGMENT_LABELS, type SegmentLabel } from "./phase19PreRegistration";

/**
 * Fase 20 — Nuevas Fuentes de Edge. Congelación total (spec Condición 1):
 * cada fórmula, ventana, umbral, lag, sesión y criterio de muestra de las
 * 5 familias aprobadas vive aquí como constante, ANTES de que ningún
 * módulo de Discovery o Validation lea un solo bar. Nada de este archivo
 * se modifica después de observar VALIDATION/OOS — cualquier cambio
 * posterior a la primera ejecución de Validation invalidaría la fase.
 *
 * Reutiliza `FROZEN_DATASET`/`FROZEN_RANGES`/`FROZEN_WALK_FORWARD_OPTIONS`
 * de Fase 18 sin redefinirlos (misma partición IS/VALIDATION/OOS, mismo
 * hash, mismo dataset, misma configuración de walk-forward). Reutiliza
 * también los escenarios de stress, el perfil de evaluación y los ids de
 * ReplayRun de Fase 19 (F20-B/C/E pasan por el mismo pipeline de
 * costes/slippage/Monte Carlo que las 9 estrategias originales, spec
 * Condición 5/11; F20-D lee los trades YA producidos por Fase 18/19 sobre
 * esos mismos 9 replayRunId, spec Condición 6).
 */
export { FROZEN_DATASET, FROZEN_RANGES, FROZEN_WALK_FORWARD_OPTIONS, FROZEN_STRESS_SCENARIOS, FROZEN_EVALUATION_PROFILE, RUIN_THRESHOLD_PCT, RETURN_THRESHOLDS_PCT, DRAWDOWN_THRESHOLDS_PCT, FROZEN_PHASE18_REPLAY_RUN_IDS, SEGMENT_LABELS, type SegmentLabel };

/** Section 5 (Fase 19 convention, reused) — Monte Carlo bootstrap over F20-B/C/E's own new trades. A DIFFERENT seed (20, matching this phase's own `F20A_BOOTSTRAP_CONFIG.seed`) than Fase 19's (19) — deliberate, so F20's resampling is never byte-identical to Fase 19's by coincidence — but the SAME iteration count and every other convention. */
export const FROZEN_MONTE_CARLO_CONFIG = { seed: 20, iterations: 10_000 };

/** Exactamente las 5 familias aprobadas — spec: "NO añadas una sexta familia. NO sustituyas una familia por otra." */
export const FROZEN_HYPOTHESIS_IDS = ["f20-a-return-autocorrelation", "f20-b-volatility-transition-shock", "f20-c-volume-price-divergence", "f20-d-session-effect", "f20-e-compression-duration"] as const;
export type Phase20HypothesisId = (typeof FROZEN_HYPOTHESIS_IDS)[number];

// ── F20-A — Return Autocorrelation Structure ────────────────────────────
/** Lags fijos en horas (spec Condición 4) — nunca ampliados ni reducidos tras ver resultados. */
export const F20A_LAGS_HOURS = [1, 2, 3, 6, 12, 24] as const;
/** Bootstrap de bloques para el intervalo de confianza de cada ρ(k) — mismo seed/convención que Fase 19, nunca re-tuneado. */
export const F20A_BOOTSTRAP_CONFIG = { iterations: 5000, seed: 20, blockSize: 24 };

// ── F20-B — Volatility Regime Transition Shock ──────────────────────────
export const F20B_PARAMS = {
  transitionWindowBars: 3, // nº de velas en las que debe completarse LOW_VOLATILITY -> HIGH_VOLATILITY
  volatilityPeriod: 14, // mismo periodo ATR que los 4 baselines de Fase 11
  rrr: 1.5,
};

// ── F20-C — Volume-Price Divergence ─────────────────────────────────────
export const F20C_PARAMS = {
  lookback: 20, // mismo lookback que Breakout Baseline (Fase 11), para comparabilidad directa
  volatilityPeriod: 14,
  volumeRatioThreshold: 0.7, // el volumen del nuevo extremo debe ser < 70% del volumen medio del lookback previo
  rrr: 1.5,
};

// ── F20-D — Session / Time-of-Day Structural Effect ─────────────────────
export type SessionName = "ASIA" | "LONDON" | "NY";
/** Fronteras FIJAS en hora UTC, nunca las 24 horas individuales (spec Condición 6). Solapamiento LONDON/NY (13-16h) es una convención estándar de mercado, no una elección post-hoc. */
export const F20D_SESSIONS: { name: SessionName; startHourUtc: number; endHourUtcExclusive: number }[] = [
  { name: "ASIA", startHourUtc: 0, endHourUtcExclusive: 8 },
  { name: "LONDON", startHourUtc: 8, endHourUtcExclusive: 16 },
  { name: "NY", startHourUtc: 13, endHourUtcExclusive: 21 },
];
/**
 * Spec Condición 6 — "estándar de evidencia especialmente estricto".
 * F20-D exige el nivel más alto de la jerarquía de Fase 18 (SUPPORTED, no
 * WEAK_SUPPORT) para considerarse evidencia, precisamente por el riesgo de
 * comparaciones múltiples entre 3 buckets. Documentado aquí, nunca
 * relajado tras ver resultados.
 */
export const F20D_MIN_EVIDENCE_LEVEL = "SUPPORTED" as const;
/** Decisión congelada ANTES de Discovery (spec Condición 6): F20-D permanece un estudio descriptivo esta fase; NO se formaliza como StrategyDefinition en F20 bajo ninguna circunstancia — esa decisión, de tomarse, pertenece a una fase posterior con su propio pre-registro. */
export const F20D_FORMALIZE_AS_STRATEGY = false;

// ── F20-E — Compression Duration ("Coiling Length") ─────────────────────
export const F20E_PARAMS = {
  atrPeriod: 14,
  squeezeLookback: 40, // MISMOS valores que F17-A (Volatility Squeeze), reutilizados sin re-elegir, para que la comparación de novedad (Condición 7) sea limpia
  squeezePercentile: 20,
  rangeLookback: 10,
  expansionMultiplier: 1.3,
  minCoilLength: 10, // umbral NUEVO de esta familia: nº mínimo de velas consecutivas en compresión antes de considerar la ruptura (F17-A no exige duración mínima, solo el estado de la vela inmediatamente anterior)
  rrr: 1.5,
};

// ── Muestra mínima (reutilizado de Fase 12/18/19, nunca redefinido) ─────
export const MIN_SAMPLE_SIZE = 20;

// ── Protocolo de evaluación — mismo perfil de riesgo que F11/17/18/19 ───
export const FROZEN_RISK_LEVEL = 5;
export const FROZEN_INITIAL_CAPITAL = 20000;

// ── Comparación incremental (spec Condiciones 7/8) ──────────────────────
/**
 * Umbrales FIJOS para clasificar "¿esta hipótesis aporta información
 * incremental o es redundante con una estrategia ya existente?", congelados
 * ANTES de ejecutar ninguna comparación (Condición 14 — nada de elegir el
 * umbral después de ver el resultado). Se combinan dos señales — correlación
 * de P&L diario y solapamiento temporal de operaciones — precisamente
 * porque ninguna de las dos sola basta: dos estrategias pueden operar en
 * momentos distintos pero seguir capturando el mismo efecto subyacente
 * (correlación alta, solapamiento bajo), o solaparse mucho en el tiempo sin
 * que sus resultados estén relacionados (solapamiento alto, correlación
 * baja). Solo cuando AMBAS son altas se declara REDUNDANTE; solo cuando
 * AMBAS son bajas se declara DISTINTA/INCREMENTAL; cualquier otra
 * combinación queda como PARCIALMENTE_DISTINTA (ninguna conclusión fuerte).
 */
export const EDGE_COMPARISON_THRESHOLDS = {
  correlationHigh: 0.7,
  correlationLow: 0.3,
  temporalOverlapHigh: 0.6,
  temporalOverlapLow: 0.3,
};
