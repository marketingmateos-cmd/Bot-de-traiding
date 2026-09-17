import { BASELINE_COST_MODEL } from "@/lib/engines/strategy/baseline/shared";
import { computeIsValidationOosRanges, SUPPLEMENTARY_WALK_FORWARD_OPTIONS, type IsValidationOosRangesWithLabels } from "./hypothesisValidation";
import { FROZEN_STRESS_SCENARIOS, type StressScenario } from "./phase19PreRegistration";
import { getAuthorizedEntries, type AssetClass, type CanonicalSymbol, type ResearchTimeframe, type ResearchUniverseEntry } from "./mt5ResearchUniverseV1";

/**
 * F23 — DISEÑO, ESPECIFICACIÓN Y PREPARACIÓN DEL PIPELINE. Spec-only:
 * ESTA FASE NO EJECUTA NADA. No hay Discovery, no hay backtest, no hay
 * ResearchDataset, no hay descarga de histórico. Cada constante de este
 * archivo queda congelada ANTES de que ningún módulo de F23 lea un solo
 * bar — exactamente la misma disciplina de "pre-registro congelado" que
 * F18-F22 ya establecieron (nada se re-tunea después de ver resultados,
 * spec Condición 8).
 *
 * DIFERENCIA DELIBERADA con F18-F22: aquellas fases congelaban un
 * `FROZEN_DATASET` con fechas/hash reales porque el dataset YA estaba
 * `registerResearchDataset()`-ado. F23 NO congela ningún dataset aquí a
 * propósito — el MT5 Research Universe v1 (`mt5ResearchUniverseV1.ts`) es
 * explícitamente de solo lectura hasta una fase de ingesta separada
 * ("read-only-until-explicit-ingestion-phase"), y ningún `ResearchDataset`
 * existe todavía para EURUSD/USDJPY/XAUUSD. Fabricar fechas/hash aquí
 * violaría "F23 NO DEBE INVENTAR DATOS DE MERCADO". Cuando la ingesta
 * ocurra (fase futura y explícita), sus hechos confirmados (hash, rango,
 * rowCount, gapCount) se añadirán a este archivo ANTES de correr
 * Discovery — nunca se recomputan a mitad de la fase.
 */

// ── 0. SEPARACIÓN ESTRICTA DE ETAPAS (Principio 1 del pre-registro) ────────
/** Orden fijo, nunca reordenado ni saltado — cada etapa solo puede leer resultados de las etapas anteriores, nunca de una posterior. */
export const FROZEN_PIPELINE_STAGES = ["DISCOVERY", "VALIDATION", "OUT_OF_SAMPLE", "WALK_FORWARD", "ROBUSTNESS", "CONCLUSION"] as const;
export type F23PipelineStage = (typeof FROZEN_PIPELINE_STAGES)[number];

// ── 1. UNIVERSO — leído dinámicamente del Research Universe v1 ─────────────
/**
 * NUNCA hardcodea BTCUSD/ETHUSD/US500 como autorizados: `buildF23Universe()`
 * simplemente proyecta `getAuthorizedEntries()` (que filtra por
 * `researchFitness === "AUTHORIZED_FOR_RESEARCH"`) a los campos que F23
 * necesita. El parámetro por defecto es la fuente de verdad real — el
 * parámetro inyectable existe solo para que los tests puedan probar que el
 * mecanismo generaliza (p. ej. "si BTCUSD se autorizase mañana, aparecería
 * aquí automáticamente") sin mutar el registro congelado real. Si la
 * auditoría post-fix (commit `688ebea`) cambia el estado de BTCUSD/ETHUSD/
 * US500 a AUTHORIZED_FOR_RESEARCH, esta función lo recoge sin ningún
 * cambio de código en F23.
 */
export interface F23UniverseEntry {
  canonicalSymbol: CanonicalSymbol;
  timeframe: ResearchTimeframe;
  assetClass: AssetClass;
}

export function buildF23Universe(entries: readonly ResearchUniverseEntry[] = getAuthorizedEntries()): readonly F23UniverseEntry[] {
  return entries.map((e) => ({ canonicalSymbol: e.canonicalSymbol, timeframe: e.timeframe, assetClass: e.assetClass }));
}

/** Snapshot evaluado al cargar el módulo — hoy: las 9 combinaciones EURUSD/USDJPY/XAUUSD × H1/H4/D1, y ninguna otra. */
export const FROZEN_UNIVERSE_SNAPSHOT: readonly F23UniverseEntry[] = buildF23Universe();

// ── 2. VENTANAS TEMPORALES / SPLITS IS-VALIDATION-OOS ───────────────────────
/**
 * Reutiliza el split cronológico 60/20/20 de `hypothesisValidation.ts`
 * (`computeIsValidationOosRanges`) SIN reimplementarlo — el mismo código ya
 * auditado en F13/F15/F18-F22. No se invoca aquí con fechas: las fechas
 * reales solo existirán cuando exista un dataset ingerido. Esta función
 * queda expuesta para que la fase de ingesta (futura) la llame con las
 * fechas reales confirmadas, sin que F23 tenga que reimplementar el split.
 */
export function buildF23Ranges(startDate: Date, endDate: Date): IsValidationOosRangesWithLabels {
  const ranges = computeIsValidationOosRanges(startDate, endDate);
  if (!ranges) {
    throw new Error("F23: el rango de fechas dado es demasiado corto para IS/VALIDATION/OOS (mínimo ~30 días) — STOP, spec regla de parada 1.");
  }
  return ranges;
}

/** Reutilizado sin cambios de F13/F18 — mismas ventanas de walk-forward, nunca re-tuneadas para F23. */
export const FROZEN_WALK_FORWARD_OPTIONS = SUPPLEMENTARY_WALK_FORWARD_OPTIONS;

// ── 3. COSTES / SLIPPAGE ────────────────────────────────────────────────────
/**
 * Reutiliza `BASELINE_COST_MODEL` (feeBps: 10, slippageBps: 5) — el mismo
 * supuesto de costes que F11/F17/F18/F19 ya usan para sus estrategias. Para
 * FX/Metal (el universo autorizado hoy) este supuesto NO ha sido confirmado
 * contra el spread real del broker (ninguna de las fases MT5 hasta ahora
 * capturó bid/ask, solo OHLCV) — se marca explícitamente como PLACEHOLDER
 * pendiente de confirmación real, nunca como un hecho medido. Las pruebas
 * de robustez (`FROZEN_STRESS_SCENARIOS`, reutilizado de F19) existen
 * precisamente para acotar el riesgo de este supuesto siendo optimista.
 */
export const FROZEN_COST_MODEL = { ...BASELINE_COST_MODEL, confirmed: false as const };
export { FROZEN_STRESS_SCENARIOS, type StressScenario };

// ── 4. MÉTRICAS ──────────────────────────────────────────────────────────────
/** Ninguna métrica individual es criterio de aprobación por sí sola — ver `FROZEN_NO_EDGE_CRITERIA` y `phase18Evidence.classifyStrategyEvidence` (reutilizado, no reimplementado) para cómo se combinan. */
export const FROZEN_F23_METRICS = [
  "tradeCount",
  "cumulativeReturnPct",
  "cagrPct",
  "volatilityPct",
  "maxDrawdownPct",
  "sharpeRatio",
  "sortinoRatio",
  "winRatePct",
  "profitFactor",
  "expectancyPct",
  "returnDistribution",
] as const;
export type F23Metric = (typeof FROZEN_F23_METRICS)[number];

// ── 5. MUESTRA MÍNIMA (reutilizado de F12/F18-F22, nunca redefinido) ────────
export const MIN_SAMPLE_SIZE = 20;

// ── 6. SIGNIFICANCIA + CORRECCIÓN POR MÚLTIPLES COMPARACIONES ──────────────
/**
 * F23 es la primera fase que busca sobre muchas configuraciones
 * (familia × activo × timeframe × punto de grid) a la vez — exactamente el
 * escenario en el que unos cuantos resultados "significativos" se esperan
 * por puro azar si no se corrige. `multipleComparisonsCorrection.ts`
 * (módulo nuevo de esta fase) reporta AMBOS métodos siempre, nunca se
 * elige el más favorable después de ver los p-valores.
 */
export const FROZEN_SIGNIFICANCE_CONFIG = {
  /** Bonferroni: alpha familywise total repartido entre m tests — el límite estricto. */
  familywiseAlpha: 0.05,
  /** Benjamini-Hochberg: tasa de falso descubrimiento esperada entre los declarados significativos — el estándar para búsquedas grandes. */
  fdrQ: 0.1,
  primaryMethod: "benjamini_hochberg_fdr" as const,
  secondaryMethod: "bonferroni" as const,
} as const;

// ── 7. MONTE CARLO / BOOTSTRAP ──────────────────────────────────────────────
/**
 * Reutiliza el motor de `phase19MonteCarlo.ts` sin reimplementarlo — seed
 * NUEVO (23), distinto de F19 (19) / F20 (20) / F21/F22, para que el
 * remuestreo de F23 nunca coincida por accidente con el de una fase previa,
 * pero misma convención de iteraciones (10.000).
 */
export const FROZEN_MONTE_CARLO_CONFIG = { seed: 23, iterations: 10_000 };

// ── 8. REGLAS DE PARADA ─────────────────────────────────────────────────────
export const FROZEN_STOPPING_RULES: readonly string[] = [
  "STOP si el dataset ingerido para cualquier símbolo/timeframe autorizado tiene menos de ~30 días de rango total (computeIsValidationOosRanges devuelve null) — esa combinación queda fuera de Discovery, nunca se fuerza el split.",
  "STOP (marcar INCONCLUSIVE, nunca forzar un veredicto) si el segmento OOS de cualquier configuración tiene menos de MIN_SAMPLE_SIZE (20) operaciones.",
  "STOP Discovery en su totalidad si el universo autorizado (Research Universe v1) queda vacío en cualquier punto de la fase.",
  "STOP y re-registrar la fase completa desde cero si se detecta que un parámetro fue modificado después de haber observado resultados de Validation u OOS de cualquier configuración (spec Condición 8).",
  "STOP la búsqueda de parámetros dentro de una familia si su número de puntos de grid (countGridPoints) excede FROZEN_MAX_GRID_POINTS_PER_FAMILY — evita una explosión combinatoria no declarada de antemano.",
  "STOP — no descargar histórico adicional de MT5 bajo ninguna circunstancia dentro de esta fase, incluso si una muestra resulta insuficiente; ampliar una muestra después de ver que es insuficiente sería seleccionar datos por resultado.",
];

/** Techo de puntos de grid por familia, fijado ANTES de definir los rangos de búsqueda de cada familia — ver `FROZEN_F23_FAMILIES` más abajo, ninguna familia lo excede. */
export const FROZEN_MAX_GRID_POINTS_PER_FAMILY = 200;

// ── 9. CRITERIOS OBJETIVOS DE "NO EDGE" ─────────────────────────────────────
export const FROZEN_NO_EDGE_CRITERIA = {
  description:
    "Una configuración (familia × activo × timeframe × punto de grid) se declara objetivamente SIN EDGE cuando se cumple CUALQUIERA de las siguientes condiciones, sin excepción y sin importar cuán favorable parezca el resultado en IS:",
  conditions: [
    "phase18Evidence.classifyStrategyEvidence() (reutilizado, no reimplementado) devuelve NEGATIVE o REJECTED para esa configuración.",
    "phase18Evidence.classifyStrategyEvidence() devuelve INCONCLUSIVE por muestra insuficiente, sin posibilidad de ampliarla dentro del rango de datos ya confirmado (spec: nunca descargar histórico adicional para forzar significancia).",
    "El p-valor (empírico, vía bootstrap) de la configuración no sobrevive la corrección por múltiples comparaciones — ni Benjamini-Hochberg FDR ni Bonferroni — frente al total de configuraciones probadas en su familia.",
    "phase19MonteCarlo.classifyRobustness() (reutilizado) devuelve FRAGILE o NEGATIVE_ROBUST bajo el escenario de stress más severo de FROZEN_STRESS_SCENARIOS (STRESS_FEES_50_SLIPPAGE_50).",
    "La configuración depende de un único activo/timeframe, sin confirmación en al menos un segundo par autorizado de la misma familia (Principio 5 del pre-registro del usuario: 'no declarar edge por un único activo/timeframe').",
  ],
} as const;

// ── 10. FAMILIAS DE HIPÓTESIS A-G — DISEÑO, NO IMPLEMENTACIÓN ───────────────
export type F23FamilyId = "F23A" | "F23B" | "F23C" | "F23D" | "F23E" | "F23F" | "F23G";

export interface F23ParameterBound {
  min: number;
  max: number;
  step: number;
}

export interface F23FamilySpec {
  id: F23FamilyId;
  name: string;
  /** Afirmación económica/estadística FALSABLE — nunca una descripción vaga de "buscar patrones". */
  hypothesis: string;
  variables: readonly string[];
  parameterSearchBounds: Readonly<Record<string, F23ParameterBound>>;
  economicRationale: string;
  /** Qué constituiría evidencia A FAVOR — declarado antes de ver ningún dato. */
  evidenceFor: string;
  /** Qué constituiría FALSACIÓN — declarado antes de ver ningún dato, spec Principio 10 (fallar OOS = fallida aunque IS sea positivo). */
  falsificationCriteria: string;
  /** Solo true para F23-E: requiere >=2 activos simultáneos del universo autorizado, nunca se evalúa por activo individual. */
  requiresCrossSectional: boolean;
  minAssetsRequired: number;
  /** Explícitamente false para las 7 — esta fase diseña, no implementa StrategyDefinition. */
  implemented: false;
}

export const FROZEN_F23_FAMILIES: readonly F23FamilySpec[] = [
  {
    id: "F23A",
    name: "Mean Reversion Extrema",
    hypothesis: "Tras una desviación extrema del precio respecto a su media móvil (z-score >= umbral), el retorno esperado en las siguientes N barras es de signo opuesto a la desviación.",
    variables: ["lookback", "zThreshold"],
    parameterSearchBounds: { lookback: { min: 10, max: 60, step: 10 }, zThreshold: { min: 1.5, max: 3.0, step: 0.25 } },
    economicRationale: "Sobrerreacción temporal de corto plazo (microestructura/liquidez) que tiende a corregirse — hipótesis clásica de reversión a la media, ampliamente documentada fuera de este repositorio, no inventada aquí.",
    evidenceFor: "Retorno medio forward de signo opuesto a la desviación, estadísticamente significativo tras corrección por múltiples comparaciones, consistente en Validation y OOS, con al menos 2 pares del universo autorizado.",
    falsificationCriteria: "Retorno forward no significativo, de signo consistente con continuación (no reversión), o que solo aparece en IS y desaparece/se invierte en Validation u OOS.",
    requiresCrossSectional: false,
    minAssetsRequired: 1,
    implemented: false,
  },
  {
    id: "F23B",
    name: "Momentum / Continuation",
    hypothesis: "Tras un movimiento direccional sostenido de N barras, el retorno esperado en las siguientes M barras mantiene el mismo signo.",
    variables: ["lookback", "momentumThresholdPct"],
    parameterSearchBounds: { lookback: { min: 5, max: 40, step: 5 }, momentumThresholdPct: { min: 0.5, max: 3.0, step: 0.5 } },
    economicRationale: "Persistencia de tendencia por infrarreacción/efecto manada — la contraparte directa de F23-A; probar ambas sobre el mismo universo permite distinguir qué régimen domina en cada activo, en vez de asumirlo.",
    evidenceFor: "Retorno forward del mismo signo que el momentum previo, significativo tras corrección, consistente en Validation/OOS, en al menos 2 pares.",
    falsificationCriteria: "Retorno forward no significativo, de signo opuesto (reversión), o que no sobrevive OOS.",
    requiresCrossSectional: false,
    minAssetsRequired: 1,
    implemented: false,
  },
  {
    id: "F23C",
    name: "Volatility Regime",
    hypothesis: "El retorno esperado y la varianza del retorno forward difieren sistemáticamente entre el régimen de volatilidad ALTA y BAJA (percentiles de ATR).",
    variables: ["atrPeriod", "regimeLookback", "regimePercentileThreshold"],
    parameterSearchBounds: { atrPeriod: { min: 7, max: 21, step: 7 }, regimeLookback: { min: 20, max: 60, step: 20 }, regimePercentileThreshold: { min: 70, max: 90, step: 10 } },
    economicRationale: "Agrupamiento de volatilidad (volatility clustering) es un hecho estilizado bien establecido; esta familia prueba si también implica una asimetría de RETORNO esperado (no solo de riesgo) entre regímenes, en el universo FX/Metal autorizado.",
    evidenceFor: "Diferencia de retorno esperado entre regímenes ALTA/BAJA estadísticamente significativa tras corrección, estable en Validation/OOS.",
    falsificationCriteria: "Sin diferencia significativa de retorno entre regímenes, o diferencia presente solo en IS.",
    requiresCrossSectional: false,
    minAssetsRequired: 1,
    implemented: false,
  },
  {
    id: "F23D",
    name: "Breakout",
    hypothesis: "Una ruptura de rango tras un periodo de compresión de volatilidad (squeeze) predice continuación direccional en la dirección de la ruptura.",
    variables: ["squeezeLookback", "squeezePercentile", "expansionMultiplier"],
    parameterSearchBounds: { squeezeLookback: { min: 20, max: 60, step: 20 }, squeezePercentile: { min: 10, max: 30, step: 10 }, expansionMultiplier: { min: 1.2, max: 1.8, step: 0.3 } },
    economicRationale: "Misma familia ya explorada para cripto en F17-A/F20-E (compresión de volatilidad); F23-D prueba si el mismo mecanismo generaliza a un universo estructuralmente distinto (FX/Metal, con sesiones y liquidez diferentes) — un test de generalización, no una repetición.",
    evidenceFor: "Retorno forward en la dirección de la ruptura, significativo tras corrección, consistente en Validation/OOS.",
    falsificationCriteria: "Sin retorno direccional significativo tras la ruptura, o reversión inmediata (falsa ruptura sistemática).",
    requiresCrossSectional: false,
    minAssetsRequired: 1,
    implemented: false,
  },
  {
    id: "F23E",
    name: "Cross-Sectional / Relative Behaviour",
    hypothesis: "El retorno relativo entre dos activos del universo autorizado (p. ej. EURUSD vs USDJPY, o un par FX vs XAUUSD) exhibe reversión o momentum sistemático en su spread/ratio, distinto del comportamiento de cada activo por separado.",
    variables: ["correlationWindow", "relativeStrengthLookback", "spreadZThreshold"],
    parameterSearchBounds: { correlationWindow: { min: 20, max: 60, step: 20 }, relativeStrengthLookback: { min: 10, max: 40, step: 10 }, spreadZThreshold: { min: 1.5, max: 2.5, step: 0.5 } },
    economicRationale: "Efectos de rotación/valor relativo entre activos correlacionados (pares FX, o FX vs metal como refugio) son un mecanismo distinto de cualquier señal univariante — solo evaluable si el universo tiene >=2 activos simultáneos, motivo del flag requiresCrossSectional.",
    evidenceFor: "Señal en el spread/ratio significativa tras corrección, consistente en Validation/OOS, evaluada como una única serie temporal del par de activos (nunca como dos configuraciones univariantes separadas).",
    falsificationCriteria: "Sin señal significativa en el spread/ratio, o señal que desaparece al corregir por el movimiento de cada activo individualmente.",
    requiresCrossSectional: true,
    minAssetsRequired: 2,
    implemented: false,
  },
  {
    id: "F23F",
    name: "Time-of-Day / Session Effects",
    hypothesis: "El retorno y la volatilidad esperados difieren sistemáticamente entre las sesiones ASIA/LONDON/NY (fronteras fijas en hora UTC).",
    variables: ["sessionBoundaries"],
    parameterSearchBounds: {},
    economicRationale: "A diferencia de cripto (24/7, la razón por la que F20-D fue un estudio descriptivo estricto), FX y Gold son instrumentos genuinamente impulsados por sesión — liquidez y volatilidad varían de forma bien documentada por sesión de mercado; este universo es el candidato natural para probar el efecto que F20-D no pudo confirmar con el estándar de evidencia más alto sobre cripto.",
    evidenceFor: "Diferencia de retorno/volatilidad entre sesiones estadísticamente significativa tras corrección, consistente en Validation/OOS, con el estándar de evidencia más estricto (SUPPORTED, no WEAK_SUPPORT) dado el riesgo de comparaciones múltiples entre 3 buckets — misma exigencia que F20-D.",
    falsificationCriteria: "Sin diferencia significativa entre sesiones, o diferencia que no alcanza SUPPORTED.",
    requiresCrossSectional: false,
    minAssetsRequired: 1,
    implemented: false,
  },
  {
    id: "F23G",
    name: "Trend + Volatility Interaction",
    hypothesis: "La señal de momentum (F23-B) es más confiable condicionada a un régimen de volatilidad EXPANDIÉNDOSE que de forma incondicional — un efecto de interacción, no la suma de F23-B y F23-C por separado.",
    variables: ["momentumLookback", "volatilityRegimeLookback", "volatilityExpansionThreshold"],
    parameterSearchBounds: { momentumLookback: { min: 10, max: 30, step: 10 }, volatilityRegimeLookback: { min: 20, max: 40, step: 20 }, volatilityExpansionThreshold: { min: 1.1, max: 1.5, step: 0.2 } },
    economicRationale: "Prueba explícitamente si combinar dos señales univariantes ya estudiadas (F23-B, F23-C) añade información incremental más allá de cada una por separado — un test de interacción con justificación estadística propia, no una familia redundante con B o C.",
    evidenceFor: "El retorno forward condicionado a momentum + expansión de volatilidad es significativamente mayor que el retorno forward de momentum solo (incondicional), tras corrección, consistente en Validation/OOS.",
    falsificationCriteria: "Sin mejora incremental medible sobre F23-B solo, o mejora que no sobrevive OOS.",
    requiresCrossSectional: false,
    minAssetsRequired: 1,
    implemented: false,
  },
];

export const FROZEN_F23_FAMILY_IDS: readonly F23FamilyId[] = FROZEN_F23_FAMILIES.map((f) => f.id);

// ── 11. CONTROL DE MÚLTIPLES HIPÓTESIS — CONTEO DE CONFIGURACIONES ─────────
export function countGridPoints(bounds: Readonly<Record<string, F23ParameterBound>>): number {
  const entries = Object.values(bounds);
  if (entries.length === 0) return 1; // familia sin parámetros de grid (p. ej. F23-F, fronteras de sesión fijas)
  return entries.reduce((acc, b) => {
    if (b.step <= 0 || b.max < b.min) {
      throw new Error(`countGridPoints: rango de parámetro inválido (min=${b.min}, max=${b.max}, step=${b.step}).`);
    }
    const n = Math.floor((b.max - b.min) / b.step) + 1;
    return acc * n;
  }, 1);
}

export interface F23ConfigurationCountBreakdown {
  familyId: F23FamilyId;
  gridPoints: number;
  /** Nº de entradas (símbolo,timeframe) del universo a las que aplica esta familia — para F23-E (cross-sectional), 1 si el universo tiene >= minAssetsRequired activos distintos, 0 si no; para el resto, el tamaño del universo. */
  applicableUniverseSlots: number;
  totalConfigurations: number;
}

export interface F23ConfigurationCount {
  totalConfigurations: number;
  totalFamilies: number;
  totalAssets: number;
  totalTimeframes: number;
  /** Bajo el diseño de esta fase, cada configuración produce exactamente 1 test estadístico en Discovery — documentado aquí explícitamente, no asumido implícitamente en otro módulo. */
  totalStatisticalTests: number;
  breakdown: F23ConfigurationCountBreakdown[];
}

export function countF23TotalConfigurations(universe: readonly F23UniverseEntry[] = FROZEN_UNIVERSE_SNAPSHOT, families: readonly F23FamilySpec[] = FROZEN_F23_FAMILIES): F23ConfigurationCount {
  const totalAssets = new Set(universe.map((u) => u.canonicalSymbol)).size;
  const totalTimeframes = new Set(universe.map((u) => u.timeframe)).size;

  const breakdown: F23ConfigurationCountBreakdown[] = families.map((f) => {
    const gridPoints = countGridPoints(f.parameterSearchBounds);
    const applicableUniverseSlots = f.requiresCrossSectional ? (totalAssets >= f.minAssetsRequired ? 1 : 0) : universe.length;
    return { familyId: f.id, gridPoints, applicableUniverseSlots, totalConfigurations: gridPoints * applicableUniverseSlots };
  });

  const totalConfigurations = breakdown.reduce((acc, b) => acc + b.totalConfigurations, 0);
  return { totalConfigurations, totalFamilies: families.length, totalAssets, totalTimeframes, totalStatisticalTests: totalConfigurations, breakdown };
}
