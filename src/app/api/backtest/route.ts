import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStrategyById } from "@/lib/engines/strategy";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { runBacktest } from "@/lib/engines/backtest";
import { computeBuyAndHold, compareToBenchmark } from "@/lib/engines/benchmark";
import { detectOverfitting } from "@/lib/engines/overfitting";
import { toJson } from "@/lib/json";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { strategyDefId, symbol, initialEquity } = body as { strategyDefId: string; symbol: string; initialEquity?: number };

  const def = getStrategyById(strategyDefId);
  if (!def) return NextResponse.json({ ok: false, error: "Unknown strategy" }, { status: 400 });

  const asset = await prisma.asset.findUnique({ where: { symbol } });
  if (!asset) return NextResponse.json({ ok: false, error: "Unknown asset" }, { status: 400 });

  const strategyVersion = await prisma.strategyVersion.findFirst({ where: { strategyId: def.id, version: def.version } });

  const marketProvider = getMarketDataProvider();
  const marketResult = await marketProvider.getOHLCV(symbol, def.timeframe, 1200);

  // Multi-Timeframe explicitly refuses to fire without a higher-timeframe
  // read (see strategy/multiTimeframe.ts) — supply it here so the strategy
  // is actually testable rather than silently producing zero trades.
  const higherTimeframeBars =
    def.kind === "MULTI_TIMEFRAME" ? (await marketProvider.getOHLCV(symbol, "H4", 1200)).bars : undefined;

  const result = runBacktest(marketResult.bars, def, def.defaultParams, { initialEquity: initialEquity ?? 100, higherTimeframeBars });
  const benchmark = computeBuyAndHold(marketResult.bars);
  const comparison = compareToBenchmark(result.metrics, benchmark);
  const overfitting = detectOverfitting(def.defaultParams, result.metrics, null);

  let backtestId: string | null = null;
  if (strategyVersion) {
    const backtest = await prisma.backtest.create({
      data: {
        strategyVersionId: strategyVersion.id,
        kind: "SIMPLE",
        assetSymbols: toJson([symbol]),
        timeframe: def.timeframe,
        startDate: marketResult.bars[0]?.timestamp ?? new Date(),
        endDate: marketResult.bars[marketResult.bars.length - 1]?.timestamp ?? new Date(),
        costModel: toJson(def.costModel),
        status: "DONE",
        summary: toJson({ metrics: result.metrics, benchmark, comparison, overfitting }),
        completedAt: new Date(),
      },
    });
    await prisma.backtestResult.create({
      data: {
        backtestId: backtest.id,
        assetId: asset.id,
        windowLabel: "full",
        metrics: toJson(result.metrics),
        equityCurve: toJson(result.equityCurve),
        trades: toJson(result.trades),
      },
    });
    backtestId = backtest.id;
  }

  return NextResponse.json({ ok: true, backtestId, result, benchmark, comparison, overfitting, isDemo: marketResult.isDemo });
}
