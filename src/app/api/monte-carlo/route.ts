import { NextResponse } from "next/server";
import { getStrategyById } from "@/lib/engines/strategy";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { runBacktest } from "@/lib/engines/backtest";
import { runMonteCarlo } from "@/lib/engines/monteCarlo";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { strategyDefId, symbol, initialEquity } = body as { strategyDefId: string; symbol: string; initialEquity?: number };

  const def = getStrategyById(strategyDefId);
  if (!def) return NextResponse.json({ ok: false, error: "Unknown strategy" }, { status: 400 });

  const marketProvider = getMarketDataProvider();
  const marketResult = await marketProvider.getOHLCV(symbol, def.timeframe, 1200);
  const equity = initialEquity ?? 100;
  const backtestResult = runBacktest(marketResult.bars, def, def.defaultParams, { initialEquity: equity });
  const monteCarlo = runMonteCarlo(backtestResult.trades, equity, { iterations: 1000 });

  return NextResponse.json({ ok: true, baseMetrics: backtestResult.metrics, monteCarlo, tradeCount: backtestResult.trades.length, isDemo: marketResult.isDemo });
}
