import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import { runStrategyBenchmark } from "@/lib/research/strategyBenchmarkRunner";
import type { EvaluationProfileTemplate, EvaluationProfileType } from "@/lib/evaluation/evaluationRiskEngine";
import type { TimeframeCode } from "@/lib/providers/types";
import type { ReplayDataSource } from "@/lib/replay/types";

interface CreateBenchmarkBody {
  datasetSymbol: string;
  timeframe: TimeframeCode;
  startDate: string;
  endDate: string;
  evaluationProfileType: EvaluationProfileType;
  customEvaluation?: Partial<EvaluationProfileTemplate> & { initialBalance: number };
  riskLevel: number;
  strategyIds: string[];
  dataSource: ReplayDataSource;
}

const VALID_PROFILES: EvaluationProfileType[] = ["20K", "50K", "100K", "CUSTOM"];
const VALID_DATA_SOURCES: ReplayDataSource[] = ["SYNTHETIC", "HISTORICAL_REAL"];

/** Mirrors /api/replay/run's synchronous pattern exactly — the response only returns once the whole benchmark (all strategies) has finished. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<CreateBenchmarkBody>;

  if (
    !body.datasetSymbol ||
    !body.timeframe ||
    !body.startDate ||
    !body.endDate ||
    !body.evaluationProfileType ||
    !VALID_PROFILES.includes(body.evaluationProfileType) ||
    typeof body.riskLevel !== "number" ||
    !Array.isArray(body.strategyIds) ||
    body.strategyIds.length === 0 ||
    !body.dataSource ||
    !VALID_DATA_SOURCES.includes(body.dataSource)
  ) {
    return NextResponse.json({ ok: false, error: "Missing or invalid fields." }, { status: 400 });
  }
  if (body.evaluationProfileType === "CUSTOM" && (!body.customEvaluation || !body.customEvaluation.initialBalance)) {
    return NextResponse.json({ ok: false, error: "Un evaluationProfileType CUSTOM requiere customEvaluation.initialBalance." }, { status: 400 });
  }

  const startDate = new Date(body.startDate);
  const endDate = new Date(body.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return NextResponse.json({ ok: false, error: "Invalid date range." }, { status: 400 });
  }

  const benchmarkRunId = await runStrategyBenchmark({
    datasetSymbol: body.datasetSymbol,
    timeframe: body.timeframe,
    startDate,
    endDate,
    evaluationProfileType: body.evaluationProfileType,
    customEvaluation: body.customEvaluation,
    riskLevel: body.riskLevel,
    strategyIds: body.strategyIds,
    dataSource: body.dataSource,
  });

  return NextResponse.json({ ok: true, benchmarkRunId });
}

export async function GET() {
  const runs = await prisma.strategyBenchmarkRun.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { results: true } });
  return NextResponse.json({
    ok: true,
    runs: runs.map((r) => ({
      id: r.id,
      datasetSymbol: r.datasetSymbol,
      timeframe: r.timeframe,
      startDate: r.startDate,
      endDate: r.endDate,
      evaluationProfileType: r.evaluationProfileType,
      riskLevel: r.riskLevel,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      resultsCount: r.results.length,
      results: r.results.map((res) => ({
        strategyId: res.strategyId,
        strategyName: res.strategyName,
        evaluationStatus: res.evaluationStatus,
        score: fromJson(res.score, null),
        metrics: fromJson(res.metrics, null),
      })),
    })),
  });
}
