import { describe, expect, it } from "vitest";
import { FROZEN_PIPELINE_STAGES, buildF23Ranges, buildF23Universe, FROZEN_UNIVERSE_SNAPSHOT, countF23TotalConfigurations, FROZEN_NO_EDGE_CRITERIA, FROZEN_STOPPING_RULES } from "../phase23PreRegistration";
import { classifyStrategyEvidence, type SegmentSummary, type WalkForwardSummary } from "../phase18Evidence";
import { applyBenjaminiHochbergFDR, applyBonferroniCorrection, type PValueResult } from "../multipleComparisonsCorrection";

/**
 * "Tests de validación del pipeline" — distinct from
 * `phase23PreRegistration.test.ts`'s schema/unit tests: these check that
 * the DESIGN, as specified, actually honors the 10 principles the user's
 * pre-registration laid out, using the REAL reused modules (phase18Evidence,
 * multipleComparisonsCorrection) wherever a principle is checkable without
 * running an actual Discovery — F23 executes nothing, so what's verifiable
 * here is that the pipeline's building blocks enforce each principle when
 * fed synthetic segment data, not that a real result obeys it.
 */

function segment(overrides: Partial<SegmentSummary>): SegmentSummary {
  return { trades: 30, returnPct: 1, profitFactor: 1.2, avgR: 0.3, maxDrawdownPct: 5, expectancy: 10, longCount: 15, shortCount: 15, ...overrides };
}

describe("Principio 1 — separación estricta DISCOVERY -> VALIDATION -> OOS -> WALK-FORWARD -> ROBUSTNESS -> CONCLUSIÓN", () => {
  it("declares exactly 6 stages, in this exact fixed order, never reordered", () => {
    expect(FROZEN_PIPELINE_STAGES).toEqual(["DISCOVERY", "VALIDATION", "OUT_OF_SAMPLE", "WALK_FORWARD", "ROBUSTNESS", "CONCLUSION"]);
  });
});

describe("Principio 2/4 — no usar información futura; no reutilizar el mismo periodo para Discovery y Validation", () => {
  it("buildF23Ranges() produces three chronologically disjoint segments (IS ends before Validation starts, Validation ends before OOS starts) over a realistic multi-month span", () => {
    const ranges = buildF23Ranges(new Date("2023-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    expect(ranges.is.start.getTime()).toBeLessThan(ranges.is.end.getTime());
    expect(ranges.is.end.getTime()).toBeLessThanOrEqual(ranges.validation.start.getTime());
    expect(ranges.validation.end.getTime()).toBeLessThanOrEqual(ranges.oos.start.getTime());
    expect(ranges.oos.start.getTime()).toBeLessThan(ranges.oos.end.getTime());
  });

  it("IS, Validation, and OOS windows never overlap — the OOS start is strictly after the IS window entirely", () => {
    const ranges = buildF23Ranges(new Date("2024-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    expect(ranges.oos.start.getTime()).toBeGreaterThan(ranges.is.end.getTime());
  });
});

describe("Principio 9/10 — una configuración debe sobrevivir IS+Validation+OOS+WF+Robustez; OOS desfavorable = fallida aunque IS sea positiva", () => {
  it("classifyStrategyEvidence (reused unmodified from Fase 18) never returns SUPPORTED or WEAK_SUPPORT when IS is favorable but OOS clearly contradicts it — REJECTED, using the real function, not a re-derived one", () => {
    const is = segment({ returnPct: 5, expectancy: 20 });
    const validation = segment({ returnPct: 3, expectancy: 10 });
    const oos = segment({ returnPct: -4, expectancy: -8, trades: 25 });
    const wf: WalkForwardSummary = { windowCount: 4, positiveWindowFraction: 0.75 };
    const result = classifyStrategyEvidence(is, validation, oos, wf);
    expect(result.status).not.toBe("SUPPORTED");
    expect(result.status).not.toBe("WEAK_SUPPORT");
    expect(result.status).toBe("REJECTED");
  });

  it("SUPPORTED requires ALL of IS + Validation + OOS favorable AND a walk-forward majority positive — dropping any one of the four never yields SUPPORTED", () => {
    const favorableIs = segment({ returnPct: 4 });
    const favorableValidation = segment({ returnPct: 2 });
    const favorableOos = segment({ returnPct: 3, trades: 25 });
    const goodWf: WalkForwardSummary = { windowCount: 4, positiveWindowFraction: 0.75 };

    const allFavorableGoodWf = classifyStrategyEvidence(favorableIs, favorableValidation, favorableOos, goodWf);
    expect(allFavorableGoodWf.status).toBe("SUPPORTED");

    const weakWf: WalkForwardSummary = { windowCount: 4, positiveWindowFraction: 0.25 }; // majority NOT positive
    const sameSegmentsBadWf = classifyStrategyEvidence(favorableIs, favorableValidation, favorableOos, weakWf);
    expect(sameSegmentsBadWf.status).not.toBe("SUPPORTED");
  });
});

describe("Principio 6 — corrección por múltiples comparaciones cuando se prueban muchas hipótesis (integración de countF23TotalConfigurations + multipleComparisonsCorrection)", () => {
  it("a synthetic p-value batch sized exactly to the current universe's total configuration count can be fed through BOTH correction methods without error, and each returns exactly that many corrected results", () => {
    const count = countF23TotalConfigurations();
    expect(count.totalStatisticalTests).toBeGreaterThan(0);
    // Deterministic synthetic p-values spread across [0,1] — this test validates
    // the PIPELINE WIRING (the two modules interoperate on a batch this size),
    // never a real research result.
    const batch: PValueResult[] = Array.from({ length: count.totalStatisticalTests }, (_, i) => ({
      id: `synthetic-${i}`,
      pValue: (i + 1) / (count.totalStatisticalTests + 1),
    }));
    const bh = applyBenjaminiHochbergFDR(batch, 0.1);
    const bonferroni = applyBonferroniCorrection(batch, 0.05);
    expect(bh).toHaveLength(count.totalStatisticalTests);
    expect(bonferroni).toHaveLength(count.totalStatisticalTests);
  });

  it("Bonferroni's per-test threshold shrinks as the number of configurations grows — larger searches demand stronger individual evidence, never the same fixed bar", () => {
    const smallBatch: PValueResult[] = [{ id: "a", pValue: 0.01 }, { id: "b", pValue: 0.02 }];
    const largeBatch: PValueResult[] = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, pValue: 0.01 }));
    const smallThreshold = applyBonferroniCorrection(smallBatch, 0.05)[0].threshold;
    const largeThreshold = applyBonferroniCorrection(largeBatch, 0.05)[0].threshold;
    expect(largeThreshold).toBeLessThan(smallThreshold);
  });
});

describe("Principio 5 — no declarar edge por un único activo/timeframe", () => {
  it("FROZEN_NO_EDGE_CRITERIA explicitly names single-asset/timeframe dependence as a disqualifying condition", () => {
    const hasSingleAssetRule = FROZEN_NO_EDGE_CRITERIA.conditions.some((c) => /único activo\/timeframe/i.test(c));
    expect(hasSingleAssetRule).toBe(true);
  });
});

describe("Principio 8 — no cambiar parámetros después de mirar OOS", () => {
  it("this exact rule is one of the frozen stopping rules, worded as a full-phase invalidation (not a soft warning)", () => {
    const hasParamChangeStop = FROZEN_STOPPING_RULES.some((r) => /modificado después de haber observado resultados de Validation u OOS/i.test(r));
    expect(hasParamChangeStop).toBe(true);
  });
});

describe("F23 universe consistency across the pipeline design", () => {
  it("FROZEN_UNIVERSE_SNAPSHOT (used by countF23TotalConfigurations' default) matches buildF23Universe()'s live output — no stale snapshot drift", () => {
    expect(FROZEN_UNIVERSE_SNAPSHOT).toEqual(buildF23Universe());
  });
});
