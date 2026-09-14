import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import { runFullReplay } from "./runReplay";
import { runIsValidationOosReplay, type IsValidationOosRanges } from "./segments";
import { runReplayWalkForward, type ReplayWalkForwardOptions } from "./replayWalkForward";
import { runReplayRobustnessAnalysis, detectReplayOverfitting } from "./replayRobustness";
import { computeEvidenceQuality } from "./evidenceQuality";
import { ReplayDataUnavailableError } from "./errors";
import type { ReplayConfig, ReplaySegmentResult } from "./types";

export interface ReplayRunRequest {
  config: ReplayConfig;
  segments?: IsValidationOosRanges;
  walkForward?: ReplayWalkForwardOptions;
  crossAssetSymbols?: string[];
}

/**
 * Fase 7/8 orchestrator — the one function the API layer calls. Ties
 * together every STEP (1-3 core engine, 4 IS/VALIDATION/OOS, 5 walk-forward,
 * 6 AI modes — already selected via config.aiMode, 7 robustness/
 * overfitting) and persists the result as its own ReplayRun/ReplayResult
 * rows, structurally separate from every live paper-trading table.
 *
 * Always creates the ReplayRun row FIRST (status RUNNING) so a crash mid-run
 * still leaves a FAILED row with a real error message behind — never a
 * silently-lost request.
 */
export async function executeReplay(request: ReplayRunRequest): Promise<string> {
  const { config } = request;

  // Fase 14 — purely a reproducibility annotation (spec section 11): look up the
  // referenced dataset's OWN hash at this exact moment and copy it onto the
  // ReplayRun row, so the row stays reproducible-by-hash even if the
  // ResearchDataset row is ever deleted or the underlying data changes later.
  // Never alters which bars get fetched — an unknown/missing datasetId is
  // simply recorded as null, never a reason to fail the whole replay.
  const dataset = config.datasetId ? await prisma.researchDataset.findUnique({ where: { id: config.datasetId } }) : null;

  const run = await prisma.replayRun.create({
    data: {
      strategyId: config.strategyId,
      assetSymbols: toJson(config.assetSymbols),
      timeframe: config.timeframe,
      startDate: request.segments ? request.segments.is.start : config.startDate,
      endDate: request.segments ? request.segments.oos.end : config.endDate,
      aiMode: config.aiMode,
      dataSource: config.dataSource,
      initialCapital: config.initialCapital,
      riskLevel: config.riskLevel,
      hasSegments: Boolean(request.segments),
      hasWalkForward: Boolean(request.walkForward),
      datasetId: dataset?.id ?? null,
      datasetHash: dataset?.datasetHash ?? null,
      status: "RUNNING",
    },
  });

  try {
    const assets = await prisma.asset.findMany({ where: { symbol: { in: config.assetSymbols } } });
    const assetIdBySymbol = new Map(assets.map((a) => [a.symbol, a.id]));

    let segmentResults: ReplaySegmentResult[];
    let primaryResult: ReplaySegmentResult;
    let hasOos: boolean;
    let oosTrades: number;
    let dataQualityJson: string;

    if (request.segments) {
      const { is, validation, oos, dataQuality } = await runIsValidationOosReplay(config, request.segments, assetIdBySymbol);
      segmentResults = [is, validation, oos];
      primaryResult = is; // IS is the baseline for robustness/overfitting perturbations — never OOS (spec: never use OOS to adjust anything)
      hasOos = true;
      oosTrades = oos.metrics.trades;
      dataQualityJson = toJson(dataQuality);
    } else {
      const { result, dataQuality } = await runFullReplay(config, assetIdBySymbol);
      segmentResults = [result];
      primaryResult = result;
      hasOos = false;
      oosTrades = 0;
      dataQualityJson = toJson(dataQuality);
    }

    let walkForwardResult = null;
    if (request.walkForward) {
      const range = request.segments ? { start: request.segments.is.start, end: request.segments.oos.end } : { start: config.startDate, end: config.endDate };
      const { walkForward } = await runReplayWalkForward(config, range, request.walkForward, assetIdBySymbol);
      walkForwardResult = walkForward;
      if (walkForward.windows.length > 0) hasOos = true;
    }

    const robustness = await runReplayRobustnessAnalysis(config, primaryResult.metrics, walkForwardResult, assetIdBySymbol, { crossAssetSymbols: request.crossAssetSymbols });
    const overfitting = detectReplayOverfitting(config, primaryResult.metrics, walkForwardResult);
    const dataQuality = JSON.parse(dataQualityJson);
    const evidence = computeEvidenceQuality({
      dataQuality,
      metrics: primaryResult.metrics,
      decisions: primaryResult.decisions,
      robustness: robustness.classification,
      robustnessScore: robustness.score,
      overfitting,
      hasOos,
      oosTrades,
    });

    await prisma.$transaction([
      prisma.replayRun.update({
        where: { id: run.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          dataQualityReport: dataQualityJson,
          walkForward: walkForwardResult ? toJson(walkForwardResult) : null,
          robustness: toJson(robustness),
          overfitting: toJson(overfitting),
          evidence: toJson(evidence),
        },
      }),
      ...segmentResults.map((segment) =>
        prisma.replayResult.create({
          data: {
            replayRunId: run.id,
            windowLabel: segment.label,
            metrics: toJson(segment.metrics),
            equityCurve: toJson(segment.equityCurve),
            drawdownCurve: toJson(segment.drawdownCurve),
            trades: toJson(segment.trades),
            decisions: toJson(segment.decisions),
          },
        })
      ),
    ]);

    return run.id;
  } catch (err) {
    const message = err instanceof ReplayDataUnavailableError ? err.message : err instanceof Error ? err.message : "Unknown error";
    await prisma.replayRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    return run.id;
  }
}
