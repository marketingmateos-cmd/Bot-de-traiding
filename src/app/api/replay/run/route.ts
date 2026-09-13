import { NextResponse } from "next/server";
import { executeReplay } from "@/lib/replay/executeAndPersistReplay";
import type { ReplayAiMode, ReplayDataSource } from "@/lib/replay/types";
import type { TimeframeCode } from "@/lib/providers/types";

interface RunReplayBody {
  assetSymbols: string[];
  timeframe: TimeframeCode;
  startDate: string;
  endDate: string;
  strategyId: string | null;
  aiMode: ReplayAiMode;
  dataSource: ReplayDataSource;
  initialCapital: number;
  riskLevel: number;
  feeBpsOverride?: number;
  slippageBpsOverride?: number;
  segments?: {
    is: { start: string; end: string };
    validation: { start: string; end: string };
    oos: { start: string; end: string };
  };
  walkForward?: { windowSizeDays: number; trainFraction: number; stepDays: number };
  crossAssetSymbols?: string[];
}

const VALID_AI_MODES: ReplayAiMode[] = ["FULL_HISTORICAL", "DETERMINISTIC_AI", "AI_ASSISTED"];
const VALID_DATA_SOURCES: ReplayDataSource[] = ["SYNTHETIC", "HISTORICAL_REAL"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<RunReplayBody>;

  if (
    !Array.isArray(body.assetSymbols) ||
    body.assetSymbols.length === 0 ||
    !body.timeframe ||
    !body.startDate ||
    !body.endDate ||
    !body.aiMode ||
    !VALID_AI_MODES.includes(body.aiMode) ||
    !body.dataSource ||
    !VALID_DATA_SOURCES.includes(body.dataSource) ||
    typeof body.initialCapital !== "number" ||
    body.initialCapital <= 0 ||
    typeof body.riskLevel !== "number"
  ) {
    return NextResponse.json({ ok: false, error: "Missing or invalid fields" }, { status: 400 });
  }

  const startDate = new Date(body.startDate);
  const endDate = new Date(body.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return NextResponse.json({ ok: false, error: "Invalid date range" }, { status: 400 });
  }

  const runId = await executeReplay({
    config: {
      assetSymbols: body.assetSymbols,
      timeframe: body.timeframe,
      startDate,
      endDate,
      strategyId: body.strategyId ?? null,
      aiMode: body.aiMode,
      dataSource: body.dataSource,
      initialCapital: body.initialCapital,
      riskLevel: body.riskLevel,
      feeBpsOverride: body.feeBpsOverride,
      slippageBpsOverride: body.slippageBpsOverride,
    },
    segments: body.segments
      ? {
          is: { start: new Date(body.segments.is.start), end: new Date(body.segments.is.end) },
          validation: { start: new Date(body.segments.validation.start), end: new Date(body.segments.validation.end) },
          oos: { start: new Date(body.segments.oos.start), end: new Date(body.segments.oos.end) },
        }
      : undefined,
    walkForward: body.walkForward,
    crossAssetSymbols: body.crossAssetSymbols,
  });

  return NextResponse.json({ ok: true, runId });
}
