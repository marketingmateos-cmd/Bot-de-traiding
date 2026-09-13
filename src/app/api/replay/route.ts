import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";

export async function GET() {
  const runs = await prisma.replayRun.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return NextResponse.json({
    ok: true,
    runs: runs.map((r) => ({
      id: r.id,
      strategyId: r.strategyId,
      assetSymbols: fromJson<string[]>(r.assetSymbols, []),
      timeframe: r.timeframe,
      startDate: r.startDate,
      endDate: r.endDate,
      aiMode: r.aiMode,
      dataSource: r.dataSource,
      status: r.status,
      hasSegments: r.hasSegments,
      hasWalkForward: r.hasWalkForward,
      createdAt: r.createdAt,
    })),
  });
}
