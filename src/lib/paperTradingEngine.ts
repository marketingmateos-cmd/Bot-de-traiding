import { prisma } from "@/lib/db";
import { getSymbolAnalysis } from "@/lib/orchestrator";
import { getStrategyById } from "@/lib/engines/strategy";
import { getAIProvider } from "@/lib/providers/registry";
import { getBudgetStatus, recordAIUsage, getCached, setCached } from "@/lib/engines/aiBudget";
import { runTradeGate } from "@/lib/engines/tradeGate";
import { calculatePositionSize, checkExposureLimits, resolveRiskLimitsForLevel } from "@/lib/engines/riskEngine";
import { evaluateCircuitBreakers, anyBreakerTripped } from "@/lib/engines/circuitBreakers";
import { reconcilePositions, openPosition, recordRejectedOrder } from "@/lib/engines/positionStateManager";
import { getStrategyPerformanceStats } from "@/lib/engines/strategyStats";
import { assessEvidence } from "@/lib/engines/luckVsEdge";
import { createSystemAlert } from "@/lib/engines/alerts";
import { logAudit } from "@/lib/engines/auditLog";
import type { AIAnalystInput, TimeframeCode } from "@/lib/providers/types";
import type { Regime } from "@/lib/engines/regime";
import { fromJson, toJson } from "@/lib/json";

export interface ScanCandidateResult {
  symbol: string;
  strategyName: string;
  strategyVersionId: string;
  signal: { direction: "LONG" | "SHORT"; strength: number; reason: string } | null;
  verdict: "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED" | "NO_SIGNAL";
  blockedBy: string | null;
  steps: unknown;
}

/**
 * Runs one full scan cycle for a paper account: for every active
 * (strategy version, asset) pair, evaluate the strategy, run the full Trade
 * Gate, and only open a simulated position on an outright APPROVED verdict.
 * LOW_CONFIDENCE and BLOCKED candidates are still persisted (as rejected
 * orders) so the "why didn't it trade" trail is real, not just logged.
 */
export async function runPaperTradingScan(accountId: string): Promise<ScanCandidateResult[]> {
  const account = await prisma.paperAccount.findUniqueOrThrow({ where: { id: accountId } });
  const results: ScanCandidateResult[] = [];

  const reconciliation = await reconcilePositions(accountId);
  if (account.isTradingBlocked || !reconciliation.consistent) {
    await createSystemAlert({
      kind: "TRADING_BLOCKED",
      severity: "CRITICAL",
      title: "Paper trading bloqueado",
      message: account.blockedReason ?? "Falló la reconciliación de posiciones.",
    });
    return results;
  }

  const strategyVersions = await prisma.strategyVersion.findMany({
    where: { strategy: { isActive: true } },
    include: { strategy: true },
  });
  const assets = await prisma.asset.findMany({ where: { isActive: true } });

  const openPositions = await prisma.paperPosition.findMany({
    where: { accountId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } },
  });
  const openNotional = openPositions.reduce((sum, p) => sum + p.entryPrice * p.remainingQuantity, 0);
  const equity = account.cashBalance; // realized-P&L based; unrealized handled by mark-to-market job

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const tradesToday = await prisma.trade.count({ where: { accountId, closedAt: { gte: todayStart } } });
  const todaysTrades = await prisma.trade.findMany({ where: { accountId, closedAt: { gte: todayStart } } });
  const dailyPnl = todaysTrades.reduce((s, t) => s + t.netPnl, 0);
  const dailyPnlPct = account.startingBalance > 0 ? (dailyPnl / account.startingBalance) * 100 : 0;

  const allTrades = await prisma.trade.findMany({ where: { accountId }, orderBy: { closedAt: "asc" } });
  let peak = account.startingBalance;
  let running = account.startingBalance;
  let maxDrawdownPct = 0;
  for (const t of allTrades) {
    running += t.netPnl;
    peak = Math.max(peak, running);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - running) / peak) * 100);
  }

  const riskLimits = resolveRiskLimitsForLevel(account.riskLevel);
  const aiProvider = getAIProvider();
  const budget = await getBudgetStatus();

  for (const version of strategyVersions) {
    const strategyDef = getStrategyById(strategyDefinitionIdFromKind(version.strategy.kind));
    if (!strategyDef) continue;

    for (const asset of assets) {
      const allowedMarkets = fromJson<string[]>(version.allowedMarkets, []);
      if (allowedMarkets.length > 0 && !allowedMarkets.includes(asset.symbol)) continue;

      const timeframe = version.timeframe as TimeframeCode;
      const analysis = await getSymbolAnalysis(asset.symbol, timeframe);
      if (!analysis.features) continue;

      const existingPosition = openPositions.find((p) => p.assetId === asset.id && p.strategyVersionId === version.id);
      if (existingPosition) continue;

      const versionParams = fromJson<Record<string, number | string | boolean>>(version.parameters, {});
      const signal = strategyDef.evaluate(analysis.bars, analysis.features, versionParams, analysis.regime.regime);

      const breakers = await evaluateCircuitBreakers({
        accountId,
        dailyPnlPct,
        currentDrawdownPct: maxDrawdownPct,
        tradesToday,
        dataQualityScore: analysis.dataQuality.score,
        apiHealthy: true,
        positionsConsistent: reconciliation.consistent,
      });
      const breakerStatus = await anyBreakerTripped();

      if (!signal) {
        results.push({
          symbol: asset.symbol,
          strategyName: version.strategy.name,
          strategyVersionId: version.id,
          signal: null,
          verdict: "NO_SIGNAL",
          blockedBy: null,
          steps: null,
        });
        continue;
      }

      const stopLossPct = version.stopLossPct ?? strategyDef.defaultStopLossPct;
      const takeProfitPct = version.takeProfitPct ?? strategyDef.defaultTakeProfitPct;
      const entryPrice = analysis.latestPrice ?? analysis.features.close;
      const stopLoss = signal.direction === "LONG" ? entryPrice * (1 - stopLossPct / 100) : entryPrice * (1 + stopLossPct / 100);
      const takeProfit = signal.direction === "LONG" ? entryPrice * (1 + takeProfitPct / 100) : entryPrice * (1 - takeProfitPct / 100);
      const sizing = calculatePositionSize({ equity, entryPrice, stopLossPrice: stopLoss, riskPerTradePct: riskLimits.riskPerTradePct });
      const riskCheck = checkExposureLimits({
        equity,
        openNotional,
        newNotional: sizing.notional,
        limits: riskLimits,
        openPositionCount: openPositions.length,
      });

      const stats = await getStrategyPerformanceStats(version.id);
      const evidence = assessEvidence(stats);

      const analystInput: AIAnalystInput = {
        symbol: asset.symbol,
        timeframe,
        regime: analysis.regime.regime,
        indicators: {
          trend: analysis.features.trend,
          momentum: analysis.features.momentum,
          rsi: analysis.features.rsi14,
          volumeZScore: analysis.features.volumeZScore20,
        },
        marketIntelligence: analysis.marketIntelligence?.score ?? 50,
        news: analysis.news.topStories.map((n) => ({ title: n.title, sentiment: n.sentiment, importance: n.importance })),
        sentiment: { score: analysis.sentiment.current, trend: analysis.sentiment.trend, divergence: analysis.sentiment.divergence },
        onChain: Object.fromEntries(analysis.onChain.map((m) => [m.metric, m.value])),
        strategySignal: { kind: signal.kind, direction: signal.direction, strength: signal.strength },
        riskContext: { accountEquity: equity, openExposurePct: equity > 0 ? openNotional / equity : 1 },
      };

      const cacheKey = `analyst:${asset.symbol}:${version.id}:${analysis.regime.regime}:${signal.direction}:${Math.round(signal.strength * 10)}`;
      let analystResult = budget.shouldUseCacheOnly ? getCached<Awaited<ReturnType<typeof aiProvider.analyze>>>(cacheKey) : null;
      let usedCache = analystResult !== null;
      if (!analystResult) {
        analystResult = await aiProvider.analyze(analystInput);
        setCached(cacheKey, analystResult);
      }
      await recordAIUsage({ tokensIn: analystResult.tokensIn, tokensOut: analystResult.tokensOut, cached: usedCache });

      const criticResult = await aiProvider.critique({
        analyst: analystResult.output,
        context: analystInput,
        historicalStrategyStats: { trades: stats.trades, winRate: stats.winRate, sharpe: stats.sharpe },
      });
      await recordAIUsage({ tokensIn: criticResult.tokensIn, tokensOut: criticResult.tokensOut, cached: false });

      await prisma.aIAnalysis.createMany({
        data: [
          {
            kind: "ANALYST",
            assetId: asset.id,
            strategyVersionId: version.id,
            input: toJson(analystInput),
            output: toJson(analystResult.output),
            model: analystResult.model,
            tokensIn: analystResult.tokensIn,
            tokensOut: analystResult.tokensOut,
            cached: usedCache,
          },
          {
            kind: "CRITIC",
            assetId: asset.id,
            strategyVersionId: version.id,
            input: toJson({ analyst: analystResult.output }),
            output: toJson(criticResult.output),
            model: criticResult.model,
            tokensIn: criticResult.tokensIn,
            tokensOut: criticResult.tokensOut,
          },
        ],
      });

      const gate = runTradeGate({
        dataQuality: analysis.dataQuality,
        marketHealthy: true,
        regime: analysis.regime,
        recommendedRegimes: fromJson<Regime[]>(version.recommendedRegimes, []),
        strategySignal: signal,
        news: analysis.news,
        sentiment: analysis.sentiment,
        onChain: analysis.onChain,
        aiAnalyst: analystResult.output,
        aiCritic: criticResult.output,
        risk: riskCheck,
        circuitBreakerTripped: breakerStatus.tripped,
        circuitBreakerReasons: breakerStatus.reasons,
        robustness: evidence,
      });

      const snapshot = {
        features: analysis.features,
        regime: analysis.regime,
        news: analysis.news.topStories,
        sentiment: analysis.sentiment,
        onChain: analysis.onChain,
        aiAnalysis: analystResult.output,
        aiCritic: criticResult.output,
        strategyParams: versionParams,
      };

      // LOW_CONFIDENCE still executes — at half size — so a brand-new
      // strategy version can accumulate the real trade history that
      // Robustness/Luck-vs-Edge need to ever move it past LOW_CONFIDENCE.
      // Only an outright BLOCKED verdict never trades.
      const sizeMultiplier = gate.verdict === "APPROVED" ? 1 : gate.verdict === "LOW_CONFIDENCE" ? 0.5 : 0;
      const executedQuantity = sizing.quantity * sizeMultiplier;

      if (executedQuantity > 0) {
        const opened = await openPosition({
          accountId,
          assetId: asset.id,
          strategyVersionId: version.id,
          direction: signal.direction,
          requestedPrice: entryPrice,
          quantity: executedQuantity,
          stopLoss,
          takeProfit,
          trailingStopPct: version.trailingStopPct ?? strategyDef.defaultTrailingStopPct,
          feeBps: strategyDef.costModel.feeBps,
          slippageBps: strategyDef.costModel.slippageBps,
          riskLevelAtEntry: account.riskLevel,
          gateResult: gate.steps,
          snapshot,
        });
        await logAudit({ action: "PAPER_POSITION_OPENED", entity: "PaperPosition", entityId: opened.position.id, data: { symbol: asset.symbol, direction: signal.direction, verdict: gate.verdict } });
        await createSystemAlert({
          kind: gate.verdict === "APPROVED" ? "SIGNAL_APPROVED" : "SIGNAL_LOW_CONFIDENCE",
          severity: "INFO",
          title: `Posición ${signal.direction} simulada abierta (${gate.verdict}): ${asset.symbol}`,
          message: `${version.strategy.name} v${version.version} — ${signal.reason}`,
        });
        openPositions.push(opened.position);
      } else {
        await recordRejectedOrder({
          accountId,
          assetId: asset.id,
          strategyVersionId: version.id,
          direction: signal.direction,
          requestedPrice: entryPrice,
          quantity: sizing.quantity,
          gateResult: gate.steps,
          status: gate.verdict === "LOW_CONFIDENCE" ? "LOW_CONFIDENCE" : "REJECTED",
        });
        if (gate.verdict === "BLOCKED") {
          await createSystemAlert({
            kind: "SIGNAL_BLOCKED",
            severity: "WARN",
            title: `Señal bloqueada: ${asset.symbol}`,
            message: `${version.strategy.name} v${version.version} bloqueada en ${gate.blockedBy}.`,
          });
        }
      }

      results.push({
        symbol: asset.symbol,
        strategyName: version.strategy.name,
        strategyVersionId: version.id,
        signal,
        verdict: gate.verdict,
        blockedBy: gate.blockedBy,
        steps: gate.steps,
      });
    }
  }

  return results;
}

function strategyDefinitionIdFromKind(kind: string): string {
  const map: Record<string, string> = {
    TREND_FOLLOWING: "trend-following",
    MOMENTUM: "momentum",
    BREAKOUT: "breakout",
    MEAN_REVERSION: "mean-reversion",
    VOLATILITY: "volatility-expansion",
    MULTI_TIMEFRAME: "multi-timeframe",
    EVENT_DRIVEN: "event-driven",
  };
  return map[kind] ?? kind;
}

