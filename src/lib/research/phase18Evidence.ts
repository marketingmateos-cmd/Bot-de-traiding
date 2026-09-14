import { MIN_SAMPLE_SIZE } from "./regimeAnalysis";

/**
 * Fase 18 — Out-of-Sample + Walk-Forward Validation, spec sections 7/8/9/12/25.
 * Pure, pre-specified diagnostics and classification over ALREADY-computed
 * IS/VALIDATION/OOS segment summaries — written and frozen BEFORE any
 * segment was run, applied mechanically afterward, never adjusted to fit a
 * particular strategy's numbers (spec: "NO forzar ninguna categoría").
 */

export interface SegmentSummary {
  trades: number;
  returnPct: number;
  profitFactor: number | null;
  avgR: number | null;
  maxDrawdownPct: number;
  expectancy: number; // average € per trade
  longCount: number;
  shortCount: number;
}

export interface StabilityDiagnostics {
  returnSigns: { is: number; validation: number; oos: number }; // -1 | 0 | 1
  expectancySigns: { is: number; validation: number; oos: number };
  pfAboveOne: { is: boolean | null; validation: boolean | null; oos: boolean | null };
  longShortConsistent: boolean; // true when the dominant direction (LONG vs SHORT) is the same across all 3 segments with trades in both
  pfRelativeChange: { validationVsIs: number | null; oosVsIs: number | null }; // (later - is) / |is|, null if either side is null/zero
  avgRRelativeChange: { validationVsIs: number | null; oosVsIs: number | null };
  /** spec section 7 — "degradación IS→Validation"/"degradación IS→OOS": IS was favorable (return>0) and the later segment is not. */
  degradedIsToValidation: boolean;
  degradedIsToOos: boolean;
}

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function relativeChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return (to - from) / Math.abs(from);
}

function dominantDirection(s: SegmentSummary): "LONG" | "SHORT" | null {
  if (s.longCount === 0 && s.shortCount === 0) return null;
  if (s.longCount === s.shortCount) return null; // no dominant direction — never forced
  return s.longCount > s.shortCount ? "LONG" : "SHORT";
}

export function computeStabilityDiagnostics(is: SegmentSummary, validation: SegmentSummary, oos: SegmentSummary): StabilityDiagnostics {
  const directions = [dominantDirection(is), dominantDirection(validation), dominantDirection(oos)].filter((d): d is "LONG" | "SHORT" => d !== null);
  const longShortConsistent = directions.length === 0 || directions.every((d) => d === directions[0]);

  return {
    returnSigns: { is: sign(is.returnPct), validation: sign(validation.returnPct), oos: sign(oos.returnPct) },
    expectancySigns: { is: sign(is.expectancy), validation: sign(validation.expectancy), oos: sign(oos.expectancy) },
    pfAboveOne: { is: is.profitFactor === null ? null : is.profitFactor > 1, validation: validation.profitFactor === null ? null : validation.profitFactor > 1, oos: oos.profitFactor === null ? null : oos.profitFactor > 1 },
    longShortConsistent,
    pfRelativeChange: { validationVsIs: relativeChange(is.profitFactor, validation.profitFactor), oosVsIs: relativeChange(is.profitFactor, oos.profitFactor) },
    avgRRelativeChange: { validationVsIs: relativeChange(is.avgR, validation.avgR), oosVsIs: relativeChange(is.avgR, oos.avgR) },
    degradedIsToValidation: is.returnPct > 0 && validation.returnPct <= 0,
    degradedIsToOos: is.returnPct > 0 && oos.returnPct <= 0,
  };
}

export type EvidenceStatus = "SUPPORTED" | "WEAK_SUPPORT" | "INCONCLUSIVE" | "REJECTED" | "NEGATIVE";

export interface WalkForwardSummary {
  windowCount: number;
  positiveWindowFraction: number; // 0-1, meaningless (and ignored) when windowCount === 0
}

export interface EvidenceClassification {
  status: EvidenceStatus;
  reasoning: string[];
  oosSampleAdequate: boolean;
}

/**
 * Spec sections 8/9/12/25 — a single, fixed decision tree, evaluated in
 * order. Sample size (spec section 9: "no presentar como evidencia robusta
 * n < 20") gates the two POSITIVE categories only — a small OOS sample can
 * still support NEGATIVE (a consistently bad result across all three
 * segments is evidence of unfavorable behavior on its own terms, not a
 * claim of a robust edge that would require the same statistical caution).
 * No single metric decides anything by itself (spec section 12): every
 * branch below requires agreement across IS/VALIDATION/OOS and, for
 * SUPPORTED specifically, the walk-forward majority too.
 */
export function classifyStrategyEvidence(is: SegmentSummary, validation: SegmentSummary, oos: SegmentSummary, walkForward: WalkForwardSummary): EvidenceClassification {
  const diag = computeStabilityDiagnostics(is, validation, oos);
  const oosSampleAdequate = oos.trades >= MIN_SAMPLE_SIZE;
  const reasoning: string[] = [];

  const isFavorable = diag.returnSigns.is > 0;
  const validationFavorable = diag.returnSigns.validation > 0;
  const oosFavorable = diag.returnSigns.oos > 0;
  const allThreeFavorable = isFavorable && validationFavorable && oosFavorable;
  const allThreeUnfavorable = !isFavorable && !validationFavorable && !oosFavorable;
  const favorableCount = [isFavorable, validationFavorable, oosFavorable].filter(Boolean).length;

  if (allThreeUnfavorable) {
    reasoning.push("Retorno <= 0 en IS, Validation y OOS — evidencia consistente de comportamiento desfavorable en las 3 particiones.");
    return { status: "NEGATIVE", reasoning, oosSampleAdequate };
  }

  if (!oosSampleAdequate) {
    reasoning.push(`OOS tiene ${oos.trades} trades, por debajo de MIN_SAMPLE_SIZE (${MIN_SAMPLE_SIZE}) — no se puede afirmar evidencia positiva ni contradicción clara con esta muestra.`);
    return { status: "INCONCLUSIVE", reasoning, oosSampleAdequate };
  }

  if (allThreeFavorable) {
    if (walkForward.windowCount > 0 && walkForward.positiveWindowFraction >= 0.5) {
      reasoning.push("Retorno > 0 en IS, Validation y OOS (muestra OOS suficiente), y la mayoría de las ventanas walk-forward también fueron positivas — Nivel 3 de la jerarquía de evidencia (spec sección 25).");
      return { status: "SUPPORTED", reasoning, oosSampleAdequate };
    }
    reasoning.push(
      walkForward.windowCount === 0
        ? "Retorno > 0 en IS, Validation y OOS, pero no hay ventanas walk-forward evaluables para confirmar consistencia adicional — Nivel 2 de la jerarquía de evidencia (spec sección 25), no Nivel 3."
        : "Retorno > 0 en IS, Validation y OOS, pero menos de la mitad de las ventanas walk-forward fueron positivas — Nivel 2 de la jerarquía de evidencia, no Nivel 3."
    );
    return { status: "WEAK_SUPPORT", reasoning, oosSampleAdequate };
  }

  if (diag.degradedIsToOos && (isFavorable || validationFavorable)) {
    reasoning.push("IS y/o Validation fueron favorables, pero OOS (con muestra suficiente) contradice claramente esa dirección — patrón clásico de sobreajuste/no generalización.");
    return { status: "REJECTED", reasoning, oosSampleAdequate };
  }

  if (favorableCount >= 1 && oosFavorable) {
    reasoning.push(`Solo ${favorableCount} de 3 particiones fueron favorables, pero OOS sí lo fue (muestra suficiente) — evidencia insuficiente para afirmar un edge robusto.`);
    return { status: "WEAK_SUPPORT", reasoning, oosSampleAdequate };
  }

  reasoning.push("Resultados mixtos/contradictorios entre IS, Validation y OOS que no encajan en ninguna categoría clara.");
  return { status: "INCONCLUSIVE", reasoning, oosSampleAdequate };
}
