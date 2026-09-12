import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStrategyById } from "@/lib/engines/strategy";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { runWalkForward } from "@/lib/engines/walkForward";
import { detectOverfitting } from "@/lib/engines/overfitting";
import { runBacktest } from "@/lib/engines/backtest";
import { toJson } from "@/lib/json";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { strategyDefId, symbol } = body as { strategyDefId: string; symbol: string };

  const def = getStrategyById(strategyDefId);
  if (!def) return NextResponse.json({ ok: false, error: "Unknown strategy" }, { status: 400 });
  const asset = await prisma.asset.findUnique({ where: { symbol } });
  if (!asset) return NextResponse.json({ ok: false, error: "Unknown asset" }, { status: 400 });

  const marketProvider = getMarketDataProvider();
  const marketResult = await marketProvider.getOHLCV(symbol, def.timeframe, 1500);

  const wf = runWalkForward(marketResult.bars, def, def.defaultParams);
  const baseResult = runBacktest(marketResult.bars, def, def.defaultParams);
  const overfitting = detectOverfitting(def.defaultParams, baseResult.metrics, wf);

  const strategyVersion = await prisma.strategyVersion.findFirst({ where: { strategyId: def.id, version: def.version } });
  let backtestId: string | null = null;
  if (strategyVersion) {
    const backtest = await prisma.backtest.create({
      data: {
        strategyVersionId: strategyVersion.id,
        kind: "WALK_FORWARD",
        assetSymbols: toJson([symbol]),
        timeframe: def.timeframe,
        startDate: marketResult.bars[0]?.timestamp ?? new Date(),
        endDate: marketResult.bars[marketResult.bars.length - 1]?.timestamp ?? new Date(),
        costModel: toJson(def.costModel),
        status: "DONE",
        summary: toJson({ wf, overfitting }),
        completedAt: new Date(),
      },
    });
    for (const w of wf.windows) {
      await prisma.backtestResult.create({
        data: {
          backtestId: backtest.id,
          assetId: asset.id,
          windowLabel: `wf-${w.windowIndex}`,
          metrics: toJson({ train: w.trainMetrics, oos: w.oosMetrics, degraded: w.degraded }),
          equityCurve: toJson([]),
          trades: toJson([]),
        },
      });
    }
    backtestId = backtest.id;
  }

  return NextResponse.json({ ok: true, backtestId, walkForward: wf, overfitting, isDemo: marketResult.isDemo });
}
