import type { OHLCVBar, AIAnalystInput } from "@/lib/providers/types";
import { computeLatestFeatures } from "@/lib/engines/features";
import { detectRegime } from "@/lib/engines/regime";
import { evaluateDataQuality } from "@/lib/engines/dataQuality";
import { checkStopsAndTargets, simulateFill } from "@/lib/engines/paperExecution";
import { calculatePositionSize, checkExposureLimits, correlation, resolveRiskLimitsForLevel } from "@/lib/engines/riskEngine";
import { BREAKERS, type CircuitBreakerCheckContext } from "@/lib/engines/circuitBreakers";
import { runTradeGate } from "@/lib/engines/tradeGate";
import { assessEvidence } from "@/lib/engines/luckVsEdge";
import { computeTradeStats } from "@/lib/engines/strategyStats";
import { getStrategyById, STRATEGY_REGISTRY, type StrategyDefinition } from "@/lib/engines/strategy";
import { resolveAiForMode } from "./aiModes";
import { buildIntelligenceContext } from "./replayContextBuilder";
import { ReplayClock, barsAsOf } from "./replayClock";
import { ReplayPortfolio } from "./replayPortfolio";
import { computeReplayMetrics } from "./replayMetrics";
import type { ReplayConfig, ReplayDecisionRecord, ReplaySegmentLabel, ReplaySegmentResult, ReplayTradeRecord } from "./types";

const WARMUP_BARS = 60;
const CORRELATION_THRESHOLD = 0.7;
// A per-run safety ceiling on AI_ASSISTED calls only (the one mode with real
// external cost/latency) — not a trading rule, mirrors circuitBreakers.ts's
// own MAX_TRADES philosophy: protects against an accidental very-large
// replay burning through a real API budget, never meant to bind in normal use.
const MAX_AI_ASSISTED_CALLS_PER_RUN = 200;

export interface AssetMeta {
  symbol: string;
  assetId: string;
}

/**
 * Fase 7A — HistoricalReplayEngine core loop. REGLA ABSOLUTA #1/#2: at any
 * tick, every input handed to a strategy/AI/gate/risk check is built from
 * `barsAsOf(bars, tickMs)` — bars strictly at or before the clock's current
 * instant — for every single data source (market data, indicators, regime,
 * news, sentiment, on-chain, AI, Trade Gate, Risk Engine, stops/targets,
 * sizing, execution). There is no code path in this function that reads
 * `bars[...]` directly by index or slices ahead of the clock.
 *
 * REGLA ABSOLUTA #7: this function takes a `ReplayPortfolio` (in-memory
 * only) and returns a plain result object — it never imports `@/lib/db`
 * for anything but a read-only FULL_HISTORICAL AI lookup (see aiModes.ts),
 * and never touches PaperAccount/PaperPosition/Trade/BotConfig.
 *
 * Runs on PRE-FETCHED, PRE-SLICED bars — fetching real vs synthetic data
 * and gating on data quality both happen one layer up (see runReplay.ts),
 * so this same function is reused unchanged for the full run, each
 * IS/VALIDATION/OOS segment, and every walk-forward window (Fases 7D/7E).
 * `tradingStartMs` (defaults to the run's own start) lets a caller include
 * extra leading bars purely so indicators are already warm at the start of
 * a short segment, without letting any signal/trade count before it.
 */
export async function runReplayOnBars(
  config: ReplayConfig,
  barsByAsset: Map<string, OHLCVBar[]>,
  assetsMeta: Map<string, AssetMeta>,
  label: ReplaySegmentLabel,
  options?: { tradingStartMs?: number; tradingEndMs?: number }
): Promise<ReplaySegmentResult> {
  const strategies: StrategyDefinition[] = config.strategyId
    ? [getStrategyById(config.strategyId)].filter((s): s is StrategyDefinition => Boolean(s))
    : STRATEGY_REGISTRY;
  if (strategies.length === 0) throw new Error(`Unknown strategy id: ${config.strategyId}`);

  const riskLimits = resolveRiskLimitsForLevel(config.riskLevel);
  const portfolio = new ReplayPortfolio(config.initialCapital);
  const decisions: ReplayDecisionRecord[] = [];

  const allTimestamps: number[] = [];
  for (const bars of barsByAsset.values()) for (const b of bars) allTimestamps.push(b.timestamp.getTime());
  const clock = new ReplayClock(allTimestamps);

  const tradingStartMs = options?.tradingStartMs ?? config.startDate.getTime();
  const tradingEndMs = options?.tradingEndMs ?? config.endDate.getTime();
  let aiAssistedCallsUsed = 0;

  while (clock.hasNext()) {
    const tickMs = clock.advance();
    const inTradingWindow = tickMs >= tradingStartMs && tickMs <= tradingEndMs;

    // ---- 1. Manage every open position first, against THIS tick's bar only.
    for (const pos of portfolio.allOpenPositions()) {
      const assetBars = barsAsOf(barsByAsset.get(pos.asset) ?? [], tickMs);
      const bar = assetBars[assetBars.length - 1];
      if (!bar || bar.timestamp.getTime() !== tickMs) continue; // no new bar for this asset at this tick

      pos.highestSinceEntry = Math.max(pos.highestSinceEntry, bar.high);
      pos.lowestSinceEntry = Math.min(pos.lowestSinceEntry, bar.low);
      const favorable = pos.direction === "LONG" ? (pos.highestSinceEntry - pos.entryPrice) / pos.entryPrice : (pos.entryPrice - pos.lowestSinceEntry) / pos.entryPrice;
      const adverse = pos.direction === "LONG" ? (pos.entryPrice - pos.lowestSinceEntry) / pos.entryPrice : (pos.highestSinceEntry - pos.entryPrice) / pos.entryPrice;
      pos.mfe = Math.max(pos.mfe, favorable);
      pos.mae = Math.max(pos.mae, adverse);

      const stopCheck = checkStopsAndTargets({
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        currentHigh: bar.high,
        currentLow: bar.low,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        trailingStopPct: pos.trailingStopPct,
        highestSinceEntry: pos.highestSinceEntry,
        lowestSinceEntry: pos.lowestSinceEntry,
      });

      if (stopCheck.triggered && stopCheck.exitPrice !== null) {
        const strategyDef = strategies.find((s) => s.id === pos.strategyId) ?? strategies[0];
        const fill = simulateFill({
          direction: pos.direction === "LONG" ? "SHORT" : "LONG",
          requestedPrice: stopCheck.exitPrice,
          quantity: pos.quantity,
          feeBps: config.feeBpsOverride ?? strategyDef.costModel.feeBps,
          slippageBps: config.slippageBpsOverride ?? strategyDef.costModel.slippageBps,
          idempotencyKey: `replay:${label}:${pos.asset}:${pos.strategyId}:${tickMs}:exit`,
        });
        const sign = pos.direction === "LONG" ? 1 : -1;
        const grossPnl = sign * (fill.fillPrice - pos.entryPrice) * pos.quantity;
        const netPnl = grossPnl - fill.fee;
        const trade: ReplayTradeRecord = {
          asset: pos.asset,
          strategyId: pos.strategyId,
          strategyName: pos.strategyName,
          direction: pos.direction,
          entryTime: pos.entryTime,
          exitTime: new Date(tickMs).toISOString(),
          entryPrice: pos.entryPrice,
          exitPrice: fill.fillPrice,
          quantity: pos.quantity,
          fees: fill.fee,
          slippageCost: fill.slippageCost,
          grossPnl,
          netPnl,
          exitReason: stopCheck.reason ?? "SIGNAL",
          mae: pos.mae,
          mfe: pos.mfe,
          decisionIndex: pos.decisionIndex,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
        };
        portfolio.closePosition(pos.asset, pos.strategyId, trade);
      }
    }

    // ---- 2. Evaluate NEW candidates (only within the trading window).
    if (inTradingWindow) {
      for (const strategyDef of strategies) {
        for (const [symbol, bars] of barsByAsset) {
          if (portfolio.hasOpenPosition(symbol, strategyDef.id)) continue;

          const window = barsAsOf(bars, tickMs);
          if (window.length < WARMUP_BARS || window[window.length - 1].timestamp.getTime() !== tickMs) continue;

          const features = computeLatestFeatures(window);
          if (!features) continue;
          const regime = detectRegime(window);
          const signal = strategyDef.evaluate(window, features, config.strategyParamsOverride ?? strategyDef.defaultParams, regime.regime);
          if (!signal) continue; // no decision recorded — see doc comment on ReplayDecisionRecord

          const meta = assetsMeta.get(symbol);
          const priceChangePct = window.length > 20 ? ((window[window.length - 1].close - window[window.length - 21].close) / window[window.length - 21].close) * 100 : 0;
          const dataQuality = evaluateDataQuality(window, config.timeframe);
          const intelligence = buildIntelligenceContext(symbol, tickMs, priceChangePct, config.dataSource);

          const strategyTrades = portfolio.closedTrades.filter((t) => t.strategyId === strategyDef.id);
          const stats = computeTradeStats(strategyTrades);
          const evidence = assessEvidence(stats);

          const analystInput: AIAnalystInput = {
            symbol,
            timeframe: config.timeframe,
            regime: regime.regime,
            indicators: { trend: features.trend, momentum: features.momentum, rsi: features.rsi14, volumeZScore: features.volumeZScore20 },
            marketIntelligence: dataQuality.score,
            news: intelligence.news.topStories.map((n) => ({ title: n.title, sentiment: n.sentiment, importance: n.importance })),
            sentiment: { score: intelligence.sentiment.current, trend: intelligence.sentiment.trend, divergence: intelligence.sentiment.divergence },
            onChain: Object.fromEntries(intelligence.onChain.map((m) => [m.metric, m.value])),
            strategySignal: { kind: signal.kind, direction: signal.direction, strength: signal.strength },
            riskContext: { accountEquity: portfolio.cashBalance, openExposurePct: portfolio.cashBalance > 0 ? portfolio.openNotional() / portfolio.cashBalance : 1 },
          };

          let aiResult;
          if (config.aiMode === "AI_ASSISTED" && aiAssistedCallsUsed >= MAX_AI_ASSISTED_CALLS_PER_RUN) {
            aiResult = { available: false, analyst: null, critic: null, availability: "UNAVAILABLE" as const };
          } else {
            if (config.aiMode === "AI_ASSISTED") aiAssistedCallsUsed++;
            aiResult = await resolveAiForMode(
              config.aiMode,
              meta?.assetId ?? symbol,
              strategyDef.kind,
              tickMs,
              analystInput,
              stats.trades > 0 ? { trades: stats.trades, winRate: stats.winRate, sharpe: stats.sharpe } : undefined
            );
          }

          const decisionIndex = decisions.length;
          if (!aiResult.available || !aiResult.analyst || !aiResult.critic) {
            decisions.push({
              timestamp: new Date(tickMs).toISOString(),
              asset: symbol,
              availability: { marketData: config.dataSource === "SYNTHETIC" ? "SYNTHETIC" : "REAL", ...intelligence.availability, ai: "UNAVAILABLE" },
              regime: regime.regime,
              volatilityPercentile: regime.details.volatilityPercentile,
              strategyId: strategyDef.id,
              strategyName: strategyDef.name,
              signal: { direction: signal.direction, strength: signal.strength, reason: signal.reason },
              aiAnalyst: null,
              aiCritic: null,
              tradeGateVerdict: null,
              tradeGateBlockedBy: null,
              tradeGateSteps: null,
              riskPassed: null,
              riskViolations: null,
              evidenceLevel: evidence.evidenceLevel,
              decision: "SKIPPED_NO_HISTORICAL_DATA",
              positionSize: null,
              entryPrice: null,
              reason: "No existe información de IA histórica real disponible para este instante (modo FULL_HISTORICAL) — no se inventa una respuesta.",
            });
            continue;
          }

          const equity = portfolio.cashBalance;
          const openPositions = portfolio.allOpenPositions();
          const otherAssetIdsWithOpenPositions = new Set(openPositions.filter((p) => p.asset !== symbol).map((p) => p.asset));
          let correlatedOpenNotional = 0;
          for (const otherAsset of otherAssetIdsWithOpenPositions) {
            const otherWindow = barsAsOf(barsByAsset.get(otherAsset) ?? [], tickMs);
            const corr = correlation(computeReturns(window), computeReturns(otherWindow));
            if (corr !== null && Math.abs(corr) >= CORRELATION_THRESHOLD) {
              correlatedOpenNotional += openPositions.filter((p) => p.asset === otherAsset).reduce((s, p) => s + p.entryPrice * p.quantity, 0);
            }
          }

          const entryPrice = window[window.length - 1].close;
          // Fase 11 — a strategy that computed its OWN volatility-based
          // stop/target (e.g. ATR) carries it on the signal; every existing
          // strategy leaves these undefined and gets the same fixed-%
          // behavior as before.
          const stopLoss = signal.stopLossPrice ?? (signal.direction === "LONG" ? entryPrice * (1 - strategyDef.defaultStopLossPct / 100) : entryPrice * (1 + strategyDef.defaultStopLossPct / 100));
          const takeProfit = signal.takeProfitPrice ?? (signal.direction === "LONG" ? entryPrice * (1 + strategyDef.defaultTakeProfitPct / 100) : entryPrice * (1 - strategyDef.defaultTakeProfitPct / 100));
          const sizing = calculatePositionSize({ equity, entryPrice, stopLossPrice: stopLoss, riskPerTradePct: riskLimits.riskPerTradePct });

          const riskCheck = checkExposureLimits({
            equity,
            openNotional: portfolio.openNotional(),
            requestedNotional: sizing.notional,
            limits: riskLimits,
            openPositionCount: openPositions.length,
            assetOpenNotional: portfolio.assetNotional(symbol),
            correlatedOpenNotional,
          });

          const todayStart = new Date(tickMs);
          todayStart.setUTCHours(0, 0, 0, 0);
          const tradesToday = portfolio.closedTrades.filter((t) => new Date(t.exitTime).getTime() >= todayStart.getTime()).length;
          const dailyPnl = portfolio.closedTrades.filter((t) => new Date(t.exitTime).getTime() >= todayStart.getTime()).reduce((s, t) => s + t.netPnl, 0);
          const dailyPnlPct = config.initialCapital > 0 ? (dailyPnl / config.initialCapital) * 100 : 0;
          let peak = config.initialCapital;
          let running = config.initialCapital;
          let currentDrawdownPct = 0;
          for (const t of portfolio.closedTrades) {
            running += t.netPnl;
            peak = Math.max(peak, running);
            if (peak > 0) currentDrawdownPct = Math.max(currentDrawdownPct, ((peak - running) / peak) * 100);
          }
          const breakerCtx: CircuitBreakerCheckContext = {
            accountId: "replay",
            dailyPnlPct,
            currentDrawdownPct,
            tradesToday,
            dataQualityScore: dataQuality.score,
            apiHealthy: true,
            positionsConsistent: true,
          };
          const breakerResults = BREAKERS.map((b) => b.evaluate(breakerCtx));
          const circuitBreakerTripped = breakerResults.some((r) => r.tripped);
          const circuitBreakerReasons = breakerResults.filter((r) => r.tripped).map((r) => r.reason ?? "");

          const gate = runTradeGate({
            dataQuality,
            marketHealthy: true,
            regime,
            recommendedRegimes: strategyDef.recommendedRegimes,
            strategySignal: signal,
            news: intelligence.news,
            sentiment: intelligence.sentiment,
            onChain: intelligence.onChain,
            aiAnalyst: aiResult.analyst,
            aiCritic: aiResult.critic,
            risk: riskCheck,
            circuitBreakerTripped,
            circuitBreakerReasons,
            robustness: evidence,
            dailyProfitProtection: null,
          });

          const sizeMultiplier = gate.verdict === "APPROVED" ? 1 : gate.verdict === "LOW_CONFIDENCE" ? 0.5 : 0;
          // Risk Level coherence fix — see paperTradingEngine.ts's identical
          // comment: size off the Risk Engine's approved (possibly
          // clamped-down) notional, not the raw risk-based request.
          const approvedQuantity = entryPrice > 0 ? riskCheck.approvedNotional / entryPrice : 0;
          const executedQuantity = approvedQuantity * sizeMultiplier;

          let decisionKind: ReplayDecisionRecord["decision"] = "BLOCKED";
          if (executedQuantity > 0) {
            decisionKind = gate.verdict === "LOW_CONFIDENCE" ? "REDUCED_SIZE" : "OPENED";
            const entryFill = simulateFill({
              direction: signal.direction,
              requestedPrice: entryPrice,
              quantity: executedQuantity,
              feeBps: config.feeBpsOverride ?? strategyDef.costModel.feeBps,
              slippageBps: config.slippageBpsOverride ?? strategyDef.costModel.slippageBps,
              idempotencyKey: `replay:${label}:${symbol}:${strategyDef.id}:${tickMs}:entry`,
            });
            portfolio.openPosition(
              {
                asset: symbol,
                strategyId: strategyDef.id,
                strategyName: strategyDef.name,
                direction: signal.direction,
                entryPrice: entryFill.fillPrice,
                quantity: entryFill.filledQuantity,
                stopLoss,
                takeProfit,
                trailingStopPct: strategyDef.defaultTrailingStopPct,
                entryTime: new Date(tickMs).toISOString(),
                highestSinceEntry: window[window.length - 1].high,
                lowestSinceEntry: window[window.length - 1].low,
                mae: 0,
                mfe: 0,
                decisionIndex,
              },
              entryFill.fee
            );
          }

          decisions.push({
            timestamp: new Date(tickMs).toISOString(),
            asset: symbol,
            availability: { marketData: config.dataSource === "SYNTHETIC" ? "SYNTHETIC" : "REAL", ...intelligence.availability, ai: aiResult.availability },
            regime: regime.regime,
            volatilityPercentile: regime.details.volatilityPercentile,
            strategyId: strategyDef.id,
            strategyName: strategyDef.name,
            signal: { direction: signal.direction, strength: signal.strength, reason: signal.reason },
            aiAnalyst: aiResult.analyst,
            aiCritic: aiResult.critic,
            tradeGateVerdict: gate.verdict,
            tradeGateBlockedBy: gate.blockedBy,
            tradeGateSteps: gate.steps,
            riskPassed: riskCheck.passed,
            riskViolations: riskCheck.violations,
            evidenceLevel: evidence.evidenceLevel,
            decision: decisionKind,
            positionSize: executedQuantity > 0 ? executedQuantity : null,
            entryPrice: executedQuantity > 0 ? entryPrice : null,
            reason: gate.steps.find((s) => s.name === gate.blockedBy)?.detail ?? `Veredicto del Trade Gate: ${gate.verdict}.`,
          });
        }
      }
    }

    // ---- 3. Mark-to-market this tick.
    const marks = new Map<string, number>();
    for (const [symbol, bars] of barsByAsset) {
      const window = barsAsOf(bars, tickMs);
      if (window.length > 0) marks.set(symbol, window[window.length - 1].close);
    }
    if (tickMs >= tradingStartMs) portfolio.recordTick(tickMs, marks);
  }

  const drawdownCurve: { t: number; drawdownPct: number }[] = [];
  let peakEq = config.initialCapital;
  for (const point of portfolio.equityCurve) {
    peakEq = Math.max(peakEq, point.equity);
    drawdownCurve.push({ t: point.t, drawdownPct: peakEq > 0 ? ((peakEq - point.equity) / peakEq) * 100 : 0 });
  }

  const tradesInWindow = portfolio.closedTrades.filter((t) => new Date(t.exitTime).getTime() >= tradingStartMs);
  const metrics = computeReplayMetrics(portfolio.equityCurve, tradesInWindow, config.initialCapital, portfolio.exposurePct(), {
    max: portfolio.maxNotionalExposurePct(),
    avg: portfolio.avgNotionalExposurePct(),
  });

  return {
    label,
    startDate: new Date(tradingStartMs).toISOString(),
    endDate: new Date(tradingEndMs).toISOString(),
    equityCurve: portfolio.equityCurve,
    drawdownCurve,
    trades: tradesInWindow,
    decisions,
    metrics,
  };
}

function computeReturns(bars: OHLCVBar[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) returns.push((bars[i].close - prev) / prev);
  }
  return returns;
}
