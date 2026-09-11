import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStrategyById } from "@/lib/engines/strategy";
import type { StrategyDefinition, StrategyParams } from "@/lib/engines/strategy/types";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { runBacktest } from "@/lib/engines/backtest";
import { runWalkForward } from "@/lib/engines/walkForward";
import { computeRobustnessScore } from "@/lib/engines/robustness";
import { detectOverfitting } from "@/lib/engines/overfitting";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { mulberry32 } from "@/lib/providers/market-data/seeded-random";

function jitterParams(params: StrategyParams, rand: () => number): StrategyParams {
  const out: StrategyParams = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === "number" ? Number((v * (0.85 + rand() * 0.3)).toFixed(4)) : v;
  }
  return out;
}

function costModelAt(def: StrategyDefinition, multiplier: number) {
  return { feeBps: def.costModel.feeBps * multiplier, slippageBps: def.costModel.slippageBps * multiplier };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { strategyDefId, symbol } = body as { strategyDefId: string; symbol: string };

  const def = getStrategyById(strategyDefId);
  if (!def) return NextResponse.json({ ok: false, error: "Unknown strategy" }, { status: 400 });

  const marketProvider = getMarketDataProvider();
  const primaryResult = await marketProvider.getOHLCV(symbol, def.timeframe, 1200);
  const baseBacktest = runBacktest(primaryResult.bars, def, def.defaultParams);
  const walkForward = runWalkForward(primaryResult.bars, def, def.defaultParams);

  const rand = mulberry32(7);
  const parameterPerturbationReturns: number[] = [];
  for (let i = 0; i < 5; i++) {
    const jittered = jitterParams(def.defaultParams, rand);
    const r = runBacktest(primaryResult.bars, def, jittered);
    parameterPerturbationReturns.push(r.metrics.totalReturnPct);
  }

  const otherSymbols = SUPPORTED_ASSETS.map((a) => a.symbol).filter((s) => s !== symbol);
  const crossAssetReturns: number[] = [];
  for (const otherSymbol of otherSymbols) {
    const otherBars = await marketProvider.getOHLCV(otherSymbol, def.timeframe, 1200);
    const r = runBacktest(otherBars.bars, def, def.defaultParams);
    crossAssetReturns.push(r.metrics.totalReturnPct);
  }

  const costSensitivityReturns: number[] = [];
  for (const multiplier of [1.5, 2, 3]) {
    const stressedDef: StrategyDefinition = { ...def, costModel: costModelAt(def, multiplier) };
    const r = runBacktest(primaryResult.bars, stressedDef, def.defaultParams);
    costSensitivityReturns.push(r.metrics.totalReturnPct);
  }

  const robustness = computeRobustnessScore({
    baseMetrics: baseBacktest.metrics,
    walkForward,
    parameterPerturbationReturns,
    crossAssetReturns,
    costSensitivityReturns,
  });
  const overfitting = detectOverfitting(def.defaultParams, baseBacktest.metrics, walkForward);

  const strategyVersion = await prisma.strategyVersion.findFirst({ where: { strategyId: def.id, version: def.version } });
  if (strategyVersion) {
    await prisma.backtest.create({
      data: {
        strategyVersionId: strategyVersion.id,
        kind: "ROBUSTNESS",
        assetSymbols: [symbol, ...otherSymbols],
        timeframe: def.timeframe,
        startDate: primaryResult.bars[0]?.timestamp ?? new Date(),
        endDate: primaryResult.bars[primaryResult.bars.length - 1]?.timestamp ?? new Date(),
        costModel: def.costModel,
        status: "DONE",
        summary: { robustness, overfitting, parameterPerturbationReturns, crossAssetReturns, costSensitivityReturns } as object,
        completedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    baseMetrics: baseBacktest.metrics,
    robustness,
    overfitting,
    parameterPerturbationReturns,
    crossAssetReturns,
    costSensitivityReturns,
    isDemo: primaryResult.isDemo,
  });
}
