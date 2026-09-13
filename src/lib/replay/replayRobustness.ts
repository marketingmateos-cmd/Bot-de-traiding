import type { WalkForwardResult } from "@/lib/engines/walkForward";
import { computeRobustnessScore } from "@/lib/engines/robustness";
import { detectOverfitting, type OverfittingReport } from "@/lib/engines/overfitting";
import { getStrategyById } from "@/lib/engines/strategy";
import { fetchAndValidateReplayData } from "./runReplay";
import { runReplayOnBars } from "./historicalReplayEngine";
import type { ReplayConfig, ReplayMetrics } from "./types";

export type RobustnessClassification = "ROBUST" | "MODERATE" | "FRAGILE" | "INSUFFICIENT_DATA";

export interface ReplayRobustnessReport {
  score: number;
  factors: { name: string; score: number; detail: string }[];
  classification: RobustnessClassification;
}

// Mirrors luckVsEdge.ts's own MIN_TRADES_MEDIUM threshold — the same bar
// used everywhere else in this codebase for "enough trades to say anything
// at all", reused here rather than inventing a second number.
const MIN_TRADES_FOR_ROBUSTNESS_VERDICT = 30;

function jitterParams(params: Record<string, number | string | boolean>, factor: number): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "number" ? value * factor : value;
  }
  return out;
}

/**
 * Fase 7G — Robustness Lab for a full-pipeline replay. Runs the SAME
 * config under several independent stress conditions (parameter jitter,
 * higher fees/slippage, other assets) over the SAME date range, then feeds
 * every result — together with the walk-forward already computed for this
 * run (Fase 7E, "different periods") — into the existing (Fase 4,
 * unmodified) `computeRobustnessScore`. The 0-100 score alone is never the
 * final word: `classification` explicitly refuses "ROBUST" on a small
 * sample no matter how high the score is (spec: "No utilizar 'ROBUST' si
 * la muestra es insuficiente").
 */
export async function runReplayRobustnessAnalysis(
  config: ReplayConfig,
  baseMetrics: ReplayMetrics,
  walkForward: WalkForwardResult | null,
  assetIdBySymbol: Map<string, string>,
  options?: { crossAssetSymbols?: string[] }
): Promise<ReplayRobustnessReport> {
  const strategyDef = config.strategyId ? getStrategyById(config.strategyId) : null;

  // Every perturbation below is a fully independent one-off replay (its own
  // fetch + isolated in-memory portfolio, per REGLA ABSOLUTA #7) — run in
  // parallel rather than sequentially, since a research UI's "RUN REPLAY"
  // button waiting on 7+ sequential multi-month replays is a real usability
  // problem this costs nothing structurally to avoid.
  const paramJobs = strategyDef
    ? [0.85, 0.9, 1.1, 1.15].map((factor) =>
        runOneOff({ ...config, strategyParamsOverride: jitterParams(strategyDef.defaultParams, factor) }, assetIdBySymbol, `robustness-param-${factor}`)
      )
    : [];

  const baseFeeBps = strategyDef?.costModel.feeBps ?? 10;
  const baseSlippageBps = strategyDef?.costModel.slippageBps ?? 5;
  const costJobs = [1.5, 2, 3].map((multiplier) =>
    runOneOff({ ...config, feeBpsOverride: baseFeeBps * multiplier, slippageBpsOverride: baseSlippageBps * multiplier }, assetIdBySymbol, `robustness-cost-${multiplier}`)
  );

  const crossAssetJobs = (options?.crossAssetSymbols ?? []).map((symbol) => runOneOff({ ...config, assetSymbols: [symbol] }, assetIdBySymbol, `robustness-asset-${symbol}`));

  const [paramResults, costResults, crossAssetResults] = await Promise.all([Promise.all(paramJobs), Promise.all(costJobs), Promise.all(crossAssetJobs)]);

  const parameterPerturbationReturns = paramResults.map((r) => r.result).filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.metrics.totalReturnPct);
  const costSensitivityReturns = costResults.map((r) => r.result).filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.metrics.totalReturnPct);
  const crossAssetReturns = crossAssetResults.map((r) => r.result).filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.metrics.totalReturnPct);

  const report = computeRobustnessScore({ baseMetrics, walkForward, parameterPerturbationReturns, crossAssetReturns, costSensitivityReturns });

  const hasEnoughSample = baseMetrics.trades >= MIN_TRADES_FOR_ROBUSTNESS_VERDICT && (walkForward?.windows.length ?? 0) > 0;
  let classification: RobustnessClassification;
  if (!hasEnoughSample) classification = "INSUFFICIENT_DATA";
  else if (report.score >= 70) classification = "ROBUST";
  else if (report.score >= 40) classification = "MODERATE";
  else classification = "FRAGILE";

  return { score: report.score, factors: report.factors, classification };
}

async function runOneOff(config: ReplayConfig, assetIdBySymbol: Map<string, string>, label: string) {
  try {
    const { barsByAsset, assetsMeta, dataQuality } = await fetchAndValidateReplayData(config, assetIdBySymbol);
    if (dataQuality.blocksReplay) return { result: null };
    const result = await runReplayOnBars(config, barsByAsset, assetsMeta, label);
    return { result };
  } catch {
    return { result: null };
  }
}

/**
 * Fase 7H — Overfitting Detector, delegating entirely to the existing
 * (Fase 4, unmodified) `detectOverfitting` — every flag it raises is a
 * reason to raise concern, never to lower it (see its own doc comment).
 */
export function detectReplayOverfitting(config: ReplayConfig, baseMetrics: ReplayMetrics, walkForward: WalkForwardResult | null): OverfittingReport {
  const strategyDef = config.strategyId ? getStrategyById(config.strategyId) : null;
  const params = config.strategyParamsOverride ?? strategyDef?.defaultParams ?? {};
  return detectOverfitting(params, baseMetrics, walkForward);
}
