import { prisma } from "@/lib/db";
import { getSymbolAnalysis } from "@/lib/orchestrator";
import { getStrategyById } from "@/lib/engines/strategy";
import { getAIProvider } from "@/lib/providers/registry";
import { getBudgetStatus, recordAIUsage, getCached, setCached } from "@/lib/engines/aiBudget";
import { runTradeGate } from "@/lib/engines/tradeGate";
import { calculatePositionSize, checkExposureLimits, correlation, resolveRiskLimitsForLevel } from "@/lib/engines/riskEngine";
import { evaluateCircuitBreakers, anyBreakerTripped } from "@/lib/engines/circuitBreakers";
import { reconcilePositions, openPosition, recordRejectedOrder } from "@/lib/engines/positionStateManager";
import { getStrategyPerformanceStats } from "@/lib/engines/strategyStats";
import { assessEvidence } from "@/lib/engines/luckVsEdge";
import { createSystemAlert } from "@/lib/engines/alerts";
import { logAudit } from "@/lib/engines/auditLog";
import type { AIAnalystInput, AIAnalystOutput, AICriticOutput, TimeframeCode } from "@/lib/providers/types";
import type { Regime } from "@/lib/engines/regime";
import type { StrategyContext } from "@/lib/engines/strategy/types";
import { fromJson, toJson } from "@/lib/json";

// Fase 1.A6 — the next higher timeframe used to feed Multi-Timeframe's
// required `higherTimeframeTrend` context (see strategy/multiTimeframe.ts,
// which explicitly refuses to fire without it). D1 has no higher timeframe
// available, so it maps to itself (Multi-Timeframe on D1 is treated as
// already-highest and skipped below).
const HIGHER_TIMEFRAME: Record<TimeframeCode, TimeframeCode> = {
  M1: "M15",
  M5: "H1",
  M15: "H1",
  H1: "H4",
  H4: "D1",
  D1: "D1",
};

// Fase 5 — "Eliminar Max Trades como firewall principal": trade COUNT was
// never the right proxy for risk (see circuitBreakers.ts's MAX_TRADES,
// demoted to a pure technical safety ceiling, not a trading rule). The real
// controls are capital-at-risk based: exposure, concentration, drawdown,
// daily loss, and — wired in here for the first time — correlation. Several
// DIFFERENT assets that move together (e.g. BTC and ETH) can recreate the
// exact concentrated bet the same-asset concentration check (Fase 1.A4)
// exists to catch; a bar-close correlation over recent history is a simple,
// real signal for "these are actually the same bet economically."
const CORRELATION_THRESHOLD = 0.7;

function computeReturns(bars: { close: number }[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) returns.push((bars[i].close - prev) / prev);
  }
  return returns;
}

export interface ScanCandidateResult {
  symbol: string;
  strategyName: string;
  strategyVersionId: string;
  signal: { direction: "LONG" | "SHORT"; strength: number; reason: string } | null;
  verdict: "APPROVED" | "LOW_CONFIDENCE" | "BLOCKED" | "NO_SIGNAL";
  blockedBy: string | null;
  steps: unknown;
}

// Fase 1.A7 — a manual scan (POST /api/paper-trading/scan) and the
// autonomous bot loop both call runPaperTradingScan for the SAME account,
// with nothing previously stopping them from running concurrently. Two
// interleaved scans on one account would each snapshot openPositions/
// openNotional/assetNotionalByAssetId independently, race on the
// `existingPosition` duplicate check, and could open duplicate or
// over-exposed positions — the exact failure mode Fase 1.A3/A4 just fixed
// WITHIN a single scan, reappearing ACROSS two concurrent scans. Since this
// is a single persistent Node process (never horizontally scaled — see
// Fase 4), a simple in-memory per-account lock is enough: a second caller
// for the same account joins the already-running scan's result instead of
// starting an independent one.
const inFlightScans = new Map<string, Promise<ScanCandidateResult[]>>();

/**
 * Runs one full scan cycle for a paper account: for every active
 * (strategy version, asset) pair, evaluate the strategy, run the full Trade
 * Gate, and only open a simulated position on an outright APPROVED verdict.
 * LOW_CONFIDENCE and BLOCKED candidates are still persisted (as rejected
 * orders) so the "why didn't it trade" trail is real, not just logged.
 *
 * Concurrency-safe per account (Fase 1.A7): a call for an account that is
 * already mid-scan reuses that in-flight scan's result rather than running
 * a second, independent one.
 */
export function runPaperTradingScan(accountId: string): Promise<ScanCandidateResult[]> {
  const existing = inFlightScans.get(accountId);
  if (existing) return existing;

  const promise = runPaperTradingScanExclusive(accountId).finally(() => {
    inFlightScans.delete(accountId);
  });
  inFlightScans.set(accountId, promise);
  return promise;
}

async function runPaperTradingScanExclusive(accountId: string): Promise<ScanCandidateResult[]> {
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
  // `let`, not `const`: this is updated in-loop every time a new position
  // opens during this same scan (see below), so exposure checks for
  // subsequent candidates in the SAME cycle see the true, up-to-date
  // notional rather than the snapshot taken before the loop started
  // (Fase 1.A3 fix — previously stale, allowing exposure to silently
  // compound past the intended limit within one scan).
  let openNotional = openPositions.reduce((sum, p) => sum + p.entryPrice * p.remainingQuantity, 0);
  // Per-asset notional (Fase 1.A4 fix): the old code only ever prevented the
  // SAME (asset, strategyVersion) pair from opening twice — nothing stopped
  // several DIFFERENT strategies from independently piling into the same
  // asset, each individually within the aggregate exposure limit while their
  // combined bet on that one asset was not. Updated in-loop just like
  // openNotional above, so concentration checks stay accurate within the scan.
  const assetNotionalByAssetId = new Map<string, number>();
  for (const p of openPositions) {
    assetNotionalByAssetId.set(p.assetId, (assetNotionalByAssetId.get(p.assetId) ?? 0) + p.entryPrice * p.remainingQuantity);
  }
  const equity = account.cashBalance; // realized-P&L based; unrealized handled by mark-to-market job
  // Fase 5 — cache of recent-returns series per symbol, reused across
  // candidates within this same scan so checking correlation against N open
  // positions never re-fetches the same asset's bars more than once.
  const returnsBySymbol = new Map<string, number[]>();
  async function getReturnsForSymbol(symbol: string, timeframe: TimeframeCode): Promise<number[]> {
    const cacheKey = `${symbol}:${timeframe}`;
    const cached = returnsBySymbol.get(cacheKey);
    if (cached) return cached;
    const otherAnalysis = await getSymbolAnalysis(symbol, timeframe);
    const returns = computeReturns(otherAnalysis.bars);
    returnsBySymbol.set(cacheKey, returns);
    return returns;
  }

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

      // Fase 1.A6 — Multi-Timeframe and Event-Driven both structurally
      // refuse to fire without a StrategyContext (see their `evaluate`
      // implementations), but this call previously never passed one at
      // all, silently reducing both to permanently-dead strategies in live
      // paper trading. Built lazily, per strategy kind, only when needed.
      let strategyContext: StrategyContext | undefined;
      if (strategyDef.kind === "MULTI_TIMEFRAME") {
        const higherTimeframe = HIGHER_TIMEFRAME[timeframe];
        if (higherTimeframe !== timeframe) {
          const higherAnalysis = await getSymbolAnalysis(asset.symbol, higherTimeframe);
          if (higherAnalysis.features) {
            strategyContext = { higherTimeframeTrend: higherAnalysis.features.trend };
          }
        }
      } else if (strategyDef.kind === "EVENT_DRIVEN") {
        const topStory = analysis.news.topStories.reduce<(typeof analysis.news.topStories)[number] | null>(
          (best, item) => (!best || item.impactScore > best.impactScore ? item : best),
          null
        );
        if (topStory) {
          strategyContext = { newsImpactScore: topStory.impactScore, newsSentiment: topStory.sentiment };
        }
      }

      const signal = strategyDef.evaluate(analysis.bars, analysis.features, versionParams, analysis.regime.regime, strategyContext);

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

      // Fase 5 — correlation as a real risk control: sum the notional of
      // OTHER open assets (never this candidate's own — that's the
      // same-asset concentration check above) whose recent returns are
      // highly correlated with it, so several different-but-correlated
      // assets can't quietly recreate one concentrated bet.
      const candidateReturns = computeReturns(analysis.bars);
      const otherAssetIdsWithOpenPositions = new Set(openPositions.filter((p) => p.assetId !== asset.id).map((p) => p.assetId));
      let correlatedOpenNotional = 0;
      for (const otherAssetId of otherAssetIdsWithOpenPositions) {
        const otherAsset = assets.find((a) => a.id === otherAssetId);
        if (!otherAsset) continue;
        const otherReturns = await getReturnsForSymbol(otherAsset.symbol, timeframe);
        const corr = correlation(candidateReturns, otherReturns);
        if (corr !== null && Math.abs(corr) >= CORRELATION_THRESHOLD) {
          correlatedOpenNotional += openPositions
            .filter((p) => p.assetId === otherAssetId)
            .reduce((sum, p) => sum + p.entryPrice * p.remainingQuantity, 0);
        }
      }

      const riskCheck = checkExposureLimits({
        equity,
        openNotional,
        newNotional: sizing.notional,
        limits: riskLimits,
        openPositionCount: openPositions.length,
        assetOpenNotional: assetNotionalByAssetId.get(asset.id) ?? 0,
        correlatedOpenNotional,
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

      // Fase 1.A5 — real AI budget enforcement for BOTH Analyst and Critic.
      // Previously: the cache was only ever consulted once the daily budget
      // was ALREADY exhausted (so a healthy budget meant every single
      // candidate paid for a fresh call, defeating the point of caching),
      // and the Critic had no budget/cache gating at all — it always called
      // out regardless of `shouldUseCacheOnly`. Now: the cache is checked
      // first unconditionally for both, and once the budget is genuinely
      // exhausted with no cached answer available, the engine degrades to a
      // conservative, clearly-labeled fallback instead of spending more
      // budget or (worse) silently skipping the check — the fallback always
      // downgrades to LOW_CONFIDENCE, never fabricates an APPROVE.
      const analystCacheKey = `analyst:${asset.symbol}:${version.id}:${analysis.regime.regime}:${signal.direction}:${Math.round(signal.strength * 10)}`;
      let analystResult = getCached<Awaited<ReturnType<typeof aiProvider.analyze>>>(analystCacheKey);
      const analystUsedCache = analystResult !== null;
      let analystIsBudgetFallback = false;
      if (!analystResult) {
        if (budget.shouldUseCacheOnly) {
          analystIsBudgetFallback = true;
          const fallbackOutput: AIAnalystOutput = {
            signal: signal.direction,
            confidence: 0.4,
            reasons: [],
            risks: ["Presupuesto diario de IA agotado — este es un resultado de reserva conservador, no una evaluación real de la IA Analista."],
            invalidation_conditions: [],
            data_quality: 50,
            recommendation: "LOW_CONFIDENCE",
          };
          analystResult = { output: fallbackOutput, tokensIn: 0, tokensOut: 0, model: "budget-exhausted-fallback" };
        } else {
          analystResult = await aiProvider.analyze(analystInput);
          setCached(analystCacheKey, analystResult);
        }
      }
      if (!analystIsBudgetFallback) {
        await recordAIUsage({ tokensIn: analystResult.tokensIn, tokensOut: analystResult.tokensOut, cached: analystUsedCache });
      }

      // Throttle (approaching, but not yet at, the budget limit): skip the
      // Critic call when the Analyst already recommends REJECT — the Trade
      // Gate blocks outright on AI_ANALYST alone in that case (see
      // tradeGate.ts), so critiquing an already-rejected candidate spends
      // budget without ever changing the outcome.
      const criticCacheKey = `critic:${asset.symbol}:${version.id}:${analystResult.output.recommendation}:${analystResult.output.signal}:${Math.round(analystResult.output.confidence * 10)}`;
      let criticResult = getCached<Awaited<ReturnType<typeof aiProvider.critique>>>(criticCacheKey);
      const criticUsedCache = criticResult !== null;
      let criticIsBudgetFallback = false;
      if (!criticResult) {
        if (budget.shouldUseCacheOnly) {
          criticIsBudgetFallback = true;
          const fallbackOutput: AICriticOutput = {
            verdict: "LOW_CONFIDENCE",
            challengedReasons: ["Presupuesto diario de IA agotado — no se realizó una revisión crítica real de la IA."],
            biasesFound: [],
            overfittingConcern: true,
            notes: "IA Crítica omitida por presupuesto agotado — resultado de reserva conservador.",
          };
          criticResult = { output: fallbackOutput, tokensIn: 0, tokensOut: 0, model: "budget-exhausted-fallback" };
        } else if (budget.shouldThrottle && analystResult.output.recommendation === "REJECT") {
          criticIsBudgetFallback = true;
          const fallbackOutput: AICriticOutput = {
            verdict: "LOW_CONFIDENCE",
            challengedReasons: ["Revisión crítica omitida (presupuesto de IA cerca del límite) — la IA Analista ya rechazó esta señal, lo que bloquea la operación de todos modos."],
            biasesFound: [],
            overfittingConcern: false,
            notes: "Omitido por throttling de presupuesto — el veredicto del Trade Gate no depende de este resultado porque AI_ANALYST ya bloquea.",
          };
          criticResult = { output: fallbackOutput, tokensIn: 0, tokensOut: 0, model: "budget-throttle-skip" };
        } else {
          criticResult = await aiProvider.critique({
            analyst: analystResult.output,
            context: analystInput,
            historicalStrategyStats: { trades: stats.trades, winRate: stats.winRate, sharpe: stats.sharpe },
          });
          setCached(criticCacheKey, criticResult);
        }
      }
      if (!criticIsBudgetFallback) {
        await recordAIUsage({ tokensIn: criticResult.tokensIn, tokensOut: criticResult.tokensOut, cached: criticUsedCache });
      }

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
            cached: analystUsedCache,
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
            cached: criticUsedCache,
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

      // Fase 2 fix — RiskEvent was a fully dead table (never written to).
      // One row per violation the Risk Engine actually raised for this
      // candidate, independent of circuit breakers (which have their own
      // table/kinds) — this is specifically the exposure/position-size/
      // concentration decisions from checkExposureLimits.
      if (!riskCheck.passed) {
        await prisma.riskEvent.createMany({
          data: riskCheck.violationKinds.map((kind, i) => ({
            accountId,
            kind,
            severity: "WARN",
            message: riskCheck.violations[i],
            data: toJson({ symbol: asset.symbol, strategyVersionId: version.id, exposurePctAfter: riskCheck.exposurePctAfter }),
          })),
        });
      }

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
        const openedNotional = opened.position.entryPrice * opened.position.remainingQuantity;
        openNotional += openedNotional;
        assetNotionalByAssetId.set(asset.id, (assetNotionalByAssetId.get(asset.id) ?? 0) + openedNotional);
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

