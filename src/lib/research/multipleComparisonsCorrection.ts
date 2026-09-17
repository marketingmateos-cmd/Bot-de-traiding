/**
 * Multiple-hypothesis-testing correction — GENERIC, phase-agnostic.
 *
 * Nothing in this repository has ever corrected for multiple comparisons
 * before (F17/F20's "comparación incremental", `phase20Comparison.ts`, is a
 * DIFFERENT concept — pairwise redundancy between two already-selected
 * strategies, not a statistical multiple-testing correction). F23 is the
 * first phase that searches many (family × asset × timeframe × parameter)
 * configurations at once, which is exactly the setting where a handful of
 * "significant" results are expected by chance alone if nothing is
 * corrected for — this module exists to make that correction explicit,
 * reproducible, and impossible to skip silently.
 *
 * Two standard, textbook methods, deliberately NOT chosen based on which
 * one keeps more configurations "significant":
 *   - Bonferroni: controls the FAMILYWISE error rate (probability of ANY
 *     false positive across all tests) — the strict bound.
 *   - Benjamini-Hochberg: controls the FALSE DISCOVERY RATE (expected
 *     proportion of false positives AMONG the declared significant) — less
 *     conservative, standard for large multiple-comparison searches.
 * F23's pre-registration (`phase23PreRegistration.ts`) reports BOTH,
 * always, for every batch of tests — never picks whichever is more
 * favorable after seeing the p-values.
 */

export interface PValueResult {
  /** Caller-defined identifier for this test — e.g. a hypothesis/configuration id. Never reused across two different tests in the same batch (checked at runtime). */
  id: string;
  /** A p-value in [0, 1] — parametric or an empirical bootstrap p-value; this module doesn't care which, it only corrects for the number of tests performed. */
  pValue: number;
}

export interface CorrectedPValueResult extends PValueResult {
  /** 1-based rank by ascending p-value within the batch (ties broken by input order). */
  rank: number;
  /** The per-test significance threshold this method assigns this specific result (varies by rank for Benjamini-Hochberg, constant for Bonferroni). */
  threshold: number;
  /** True iff this result is declared significant AFTER correction — never derived from the raw, uncorrected p-value. */
  significant: boolean;
}

function validateBatch(results: readonly PValueResult[]): void {
  if (results.length === 0) return;
  const seenIds = new Set<string>();
  for (const r of results) {
    if (!Number.isFinite(r.pValue) || r.pValue < 0 || r.pValue > 1) {
      throw new Error(`multipleComparisonsCorrection: p-value fuera de rango [0,1] para "${r.id}" (recibido: ${r.pValue}).`);
    }
    if (seenIds.has(r.id)) {
      throw new Error(`multipleComparisonsCorrection: id de test duplicado en el mismo lote: "${r.id}".`);
    }
    seenIds.add(r.id);
  }
}

/**
 * Bonferroni correction: a single result is significant iff its raw p-value
 * is <= familywiseAlpha / m (m = number of tests in the batch). The
 * strictest of the two methods here — controls the probability of even ONE
 * false positive across the whole batch, at the cost of statistical power
 * when m is large.
 */
export function applyBonferroniCorrection(results: readonly PValueResult[], familywiseAlpha: number): CorrectedPValueResult[] {
  if (!Number.isFinite(familywiseAlpha) || familywiseAlpha <= 0 || familywiseAlpha > 1) {
    throw new Error(`applyBonferroniCorrection: familywiseAlpha debe estar en (0, 1] (recibido: ${familywiseAlpha}).`);
  }
  validateBatch(results);
  const m = results.length;
  if (m === 0) return [];
  const threshold = familywiseAlpha / m;
  const sorted = [...results].sort((a, b) => a.pValue - b.pValue);
  return sorted.map((r, i) => ({ ...r, rank: i + 1, threshold, significant: r.pValue <= threshold }));
}

/**
 * Benjamini-Hochberg false-discovery-rate correction (BH, 1995). Sort
 * p-values ascending; find the LARGEST rank k such that p_(k) <= (k/m)*fdrQ;
 * every result at rank <= k is declared significant (not just the one at
 * rank k — the standard "step-up" procedure, never a per-result independent
 * check against its own threshold alone).
 */
export function applyBenjaminiHochbergFDR(results: readonly PValueResult[], fdrQ: number): CorrectedPValueResult[] {
  if (!Number.isFinite(fdrQ) || fdrQ <= 0 || fdrQ > 1) {
    throw new Error(`applyBenjaminiHochbergFDR: fdrQ debe estar en (0, 1] (recibido: ${fdrQ}).`);
  }
  validateBatch(results);
  const m = results.length;
  if (m === 0) return [];
  const sorted = [...results].sort((a, b) => a.pValue - b.pValue);
  const withThresholds = sorted.map((r, i) => {
    const rank = i + 1;
    return { ...r, rank, threshold: (rank / m) * fdrQ };
  });

  let largestSignificantRank = 0;
  for (const r of withThresholds) {
    if (r.pValue <= r.threshold) largestSignificantRank = r.rank;
  }

  return withThresholds.map((r) => ({ ...r, significant: r.rank <= largestSignificantRank }));
}

/** Summary counts a caller (F23's reporting layer) needs alongside the per-test detail — never computed by hand elsewhere. */
export interface CorrectionSummary {
  totalTests: number;
  significantCount: number;
  significantIds: string[];
}

export function summarizeCorrection(corrected: readonly CorrectedPValueResult[]): CorrectionSummary {
  const significant = corrected.filter((r) => r.significant);
  return { totalTests: corrected.length, significantCount: significant.length, significantIds: significant.map((r) => r.id) };
}
