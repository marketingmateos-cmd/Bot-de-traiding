import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStrategyById } from "@/lib/engines/strategy";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { testHypothesis } from "@/lib/engines/hypothesis";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { statement, strategyDefId, symbol } = body as { statement: string; strategyDefId: string; symbol: string };
  if (!statement || !strategyDefId || !symbol) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  const def = getStrategyById(strategyDefId);
  if (!def) return NextResponse.json({ ok: false, error: "Unknown strategy" }, { status: 400 });

  const strategyVersion = await prisma.strategyVersion.findFirst({ where: { strategyId: def.id, version: def.version } });
  const marketProvider = getMarketDataProvider();
  const marketResult = await marketProvider.getOHLCV(symbol, def.timeframe, 1200);

  const testResult = testHypothesis(marketResult.bars, def, def.defaultParams);

  const experiment = await prisma.experiment.create({
    data: {
      name: `Hypothesis test: ${statement.slice(0, 80)}`,
      durationDays: Math.round((marketResult.bars.length * (def.timeframe === "D1" ? 1 : def.timeframe === "H4" ? 1 / 6 : def.timeframe === "H1" ? 1 / 24 : 1 / 96))),
      config: { strategyDefId, symbol, timeframe: def.timeframe },
      status: "COMPLETED",
      result: testResult as object,
      completedAt: new Date(),
    },
  });

  const hypothesis = await prisma.hypothesis.create({
    data: {
      statement,
      strategyVersionId: strategyVersion?.id,
      status: testResult.status,
      evidenceLevel: testResult.evidenceLevel,
      rationale: testResult.rationale,
      experimentId: experiment.id,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, hypothesis, testResult, isDemo: marketResult.isDemo });
}

export async function GET() {
  const hypotheses = await prisma.hypothesis.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { experiment: true, strategyVersion: { include: { strategy: true } } },
  });
  return NextResponse.json({ ok: true, hypotheses });
}
