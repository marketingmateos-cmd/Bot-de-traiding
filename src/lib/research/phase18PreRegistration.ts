import { BASELINE_STRATEGY_REGISTRY, RESEARCH_STRATEGY_REGISTRY, getHypothesis, type StrategyDefinition } from "@/lib/engines/strategy";
import { computeIsValidationOosRanges, SUPPLEMENTARY_WALK_FORWARD_OPTIONS, type IsValidationOosRangesWithLabels } from "./hypothesisValidation";
import { computeStrategyConfigHash } from "./configHash";

/**
 * Fase 18 — Out-of-Sample + Walk-Forward Validation, spec section 1
 * (Pre-Registro). This module freezes exactly what will be validated
 * BEFORE any IS/VALIDATION/OOS replay is executed: the 9 strategies (4
 * Fase 11 baselines + 5 Fase 17 research strategies, none modified here),
 * the dataset identity, the temporal partition, and the risk/evaluation
 * profile. Every value below is either a literal constant or a call into
 * an ALREADY-existing, unmodified function (`computeIsValidationOosRanges`
 * from Fase 13, `SUPPLEMENTARY_WALK_FORWARD_OPTIONS` from Fase 13) — this
 * file adds no new tunable parameter and computes nothing from results.
 *
 * Evidence this pre-registration predates any OOS observation: every
 * strategy's own hypothesis/parameters/entry/exit/SL/TP logic lives in
 * `src/lib/engines/strategy/{baseline,research}/*.ts`, committed to git in
 * Fase 11 (`b05cea0`) and Fase 17 (`b2f726f`) respectively — this file only
 * REFERENCES those already-committed definitions, it does not restate or
 * alter them.
 */

/** Fase 16's registered dataset — verified byte-identical at the start of Fase 18 (see the phase's final report, section 2). Any mismatch at run time must STOP the phase (spec section 17), never proceed silently against a different dataset. */
export const FROZEN_DATASET = {
  symbol: "BTC",
  timeframe: "H1" as const,
  startDate: new Date("2026-03-01T00:00:00.000Z"),
  endDate: new Date("2026-08-31T23:00:00.000Z"),
  rowCount: 4416,
  gapCount: 0,
  duplicateCount: 0,
  coveragePct: 100,
  isDemo: false,
  datasetHash: "8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503",
};

/**
 * Reuses Fase 13's own 60/20/20 chronological split (`computeIsValidationOosRanges`)
 * UNCHANGED — never re-derived or hand-typed here, precisely so this phase
 * cannot introduce a NEW boundary bug independent of the one already
 * audited in Fase 13/15. Frozen once, at module load, from the frozen
 * dataset's own start/end — never recomputed per strategy, per segment, or
 * after seeing any result.
 */
export const FROZEN_RANGES: IsValidationOosRangesWithLabels = (() => {
  const ranges = computeIsValidationOosRanges(FROZEN_DATASET.startDate, FROZEN_DATASET.endDate);
  if (!ranges) throw new Error("Fase 18: el dataset congelado es demasiado corto para IS/VALIDATION/OOS — esto nunca debería ocurrir con el dataset de Fase 16.");
  return ranges;
})();

/** Same supplementary walk-forward config Fase 13 already froze and documented (`WALK_FORWARD_LIMITATION_NOTE`) — reused verbatim, never re-tuned for Fase 18. */
export const FROZEN_WALK_FORWARD_OPTIONS = SUPPLEMENTARY_WALK_FORWARD_OPTIONS;

/** Spec section 16 — identical risk/evaluation profile used by every Fase 11/17 benchmark run of these same 9 strategies. */
export const FROZEN_RISK_PROFILE = { evaluationProfileType: "20K" as const, riskLevel: 5, dataSource: "HISTORICAL_REAL" as const, aiMode: "DETERMINISTIC_AI" as const };

export interface FrozenStrategyManifestEntry {
  strategyId: string;
  strategyName: string;
  version: string;
  kind: string;
  family: string | null;
  hypothesis: string | null;
  defaultParams: Record<string, number | string | boolean>;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  costModel: { feeBps: number; slippageBps: number };
  /** Same identity hash Fase 11 already computes for every StrategyBenchmarkResult (spec section 20 reproducibility) — included here so this manifest, by itself, proves nothing was altered between Fase 17 and Fase 18. */
  strategyConfigHash: string;
}

function toManifestEntry(def: StrategyDefinition): FrozenStrategyManifestEntry {
  const h = getHypothesis(def.id);
  return {
    strategyId: def.id,
    strategyName: def.name,
    version: def.version,
    kind: def.kind,
    family: h?.family ?? null,
    hypothesis: h?.hypothesis ?? null,
    defaultParams: def.defaultParams,
    defaultStopLossPct: def.defaultStopLossPct,
    defaultTakeProfitPct: def.defaultTakeProfitPct,
    costModel: def.costModel,
    strategyConfigHash: computeStrategyConfigHash(def.id, def.version, def.defaultParams),
  };
}

/** The 9 frozen strategies, in a fixed order (4 baselines first, then the 5 research families) — never reordered, never filtered based on any later result. */
export const FROZEN_STRATEGY_MANIFEST: FrozenStrategyManifestEntry[] = [...BASELINE_STRATEGY_REGISTRY, ...RESEARCH_STRATEGY_REGISTRY].map(toManifestEntry);

export const FROZEN_STRATEGY_IDS: string[] = FROZEN_STRATEGY_MANIFEST.map((s) => s.strategyId);
