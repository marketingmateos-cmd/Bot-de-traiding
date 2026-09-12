import type { OHLCVBar } from "@/lib/providers/types";
import type { StrategyDefinition, StrategyParams } from "./strategy/types";
import { computeLatestFeatures } from "./features";
import { detectRegime, isRegimeCompatible } from "./regime";
import { checkStopsAndTargets, simulateFill } from "./paperExecution";
import { calculatePositionSize } from "./riskEngine";

export interface BacktestTradeRecord {
  direction: "LONG" | "SHORT";
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  fees: number;
  netPnl: number;
  exitReason: string;
  mae: number;
  mfe: number;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  cagrPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number;
  winRate: number;
  trades: number;
  avgTradeReturnPct: number;
  profitFactor: number | null;
  finalEquity: number;
}

export interface BacktestOutput {
  equityCurve: { t: number; equity: number }[];
  trades: BacktestTradeRecord[];
  metrics: BacktestMetrics;
}

const WARMUP_BARS = 60;

/**
 * Backtest Engine (spec §23). Rules enforced structurally, not by
 * convention, to rule out look-ahead bias:
 *   - A strategy only ever sees `bars[0..i]` when evaluated at index i.
 *   - A signal generated from bar i's close only fills at bar i+1's open
 *     (with slippage/fees applied), never at bar i's own close.
 *   - Regime/feature snapshots are recomputed from the truncated window each
 *     step, never from the full series.
 * No parameter search happens here against this same window — that is the
 * caller's responsibility to keep train/OOS separated (see walkForward.ts).
 */
export function runBacktest(
  bars: OHLCVBar[],
  strategy: StrategyDefinition,
  params: StrategyParams,
  options?: { initialEquity?: number; riskPerTradePct?: number; higherTimeframeBars?: OHLCVBar[] }
): BacktestOutput {
  const initialEquity = options?.initialEquity ?? 100;
  const riskPerTradePct = options?.riskPerTradePct ?? 1;

  let equity = initialEquity;
  const equityCurve: { t: number; equity: number }[] = [];
  const trades: BacktestTradeRecord[] = [];

  let openPosition: {
    direction: "LONG" | "SHORT";
    entryPrice: number;
    quantity: number;
    stopLoss: number | null;
    takeProfit: number | null;
    entryIndex: number;
    highestSinceEntry: number;
    lowestSinceEntry: number;
    mae: number;
    mfe: number;
  } | null = null;

  let pendingSignal: { direction: "LONG" | "SHORT"; fromIndex: number } | null = null;

  for (let i = WARMUP_BARS; i < bars.length; i++) {
    const window = bars.slice(0, i + 1); // no look-ahead: only up to and including bar i
    const bar = bars[i];

    // 1. Manage an open position against this bar's range first.
    if (openPosition) {
      openPosition.highestSinceEntry = Math.max(openPosition.highestSinceEntry, bar.high);
      openPosition.lowestSinceEntry = Math.min(openPosition.lowestSinceEntry, bar.low);
      const favorable =
        openPosition.direction === "LONG"
          ? (openPosition.highestSinceEntry - openPosition.entryPrice) / openPosition.entryPrice
          : (openPosition.entryPrice - openPosition.lowestSinceEntry) / openPosition.entryPrice;
      const adverse =
        openPosition.direction === "LONG"
          ? (openPosition.entryPrice - openPosition.lowestSinceEntry) / openPosition.entryPrice
          : (openPosition.highestSinceEntry - openPosition.entryPrice) / openPosition.entryPrice;
      openPosition.mfe = Math.max(openPosition.mfe, favorable);
      openPosition.mae = Math.max(openPosition.mae, adverse);

      const stopCheck = checkStopsAndTargets({
        direction: openPosition.direction,
        entryPrice: openPosition.entryPrice,
        currentHigh: bar.high,
        currentLow: bar.low,
        stopLoss: openPosition.stopLoss,
        takeProfit: openPosition.takeProfit,
        trailingStopPct: (strategy.defaultTrailingStopPct as number) || null,
        highestSinceEntry: openPosition.highestSinceEntry,
        lowestSinceEntry: openPosition.lowestSinceEntry,
      });

      if (stopCheck.triggered && stopCheck.exitPrice !== null) {
        const fill = simulateFill({
          direction: openPosition.direction === "LONG" ? "SHORT" : "LONG",
          requestedPrice: stopCheck.exitPrice,
          quantity: openPosition.quantity,
          feeBps: strategy.costModel.feeBps,
          slippageBps: strategy.costModel.slippageBps,
          idempotencyKey: `bt:${strategy.id}:${i}:exit`,
        });
        const sign = openPosition.direction === "LONG" ? 1 : -1;
        const grossPnl = sign * (fill.fillPrice - openPosition.entryPrice) * openPosition.quantity;
        // fill.fillPrice/openPosition.entryPrice are already slippage-adjusted,
        // so grossPnl already reflects slippage — only the fee is still owed.
        // Matches the Fase 1.A2 fix in positionStateManager.ts (backtest/live parity).
        const netPnl = grossPnl - fill.fee;
        equity += netPnl;

        trades.push({
          direction: openPosition.direction,
          entryTime: bars[openPosition.entryIndex].timestamp.toISOString(),
          exitTime: bar.timestamp.toISOString(),
          entryPrice: openPosition.entryPrice,
          exitPrice: fill.fillPrice,
          quantity: openPosition.quantity,
          fees: fill.fee,
          netPnl,
          exitReason: stopCheck.reason ?? "SIGNAL",
          mae: openPosition.mae,
          mfe: openPosition.mfe,
        });
        openPosition = null;
      }
    }

    // 2. Fill a pending signal from the previous bar's close at this bar's open.
    // Sizing depends on the fill price, but the fee/slippage cost of that
    // fill depends on sizing — so the fill price is simulated once (its
    // €-denominated fee/slippage are irrelevant at this step and discarded),
    // then the real €-cost is computed from the actual position size.
    if (!openPosition && pendingSignal) {
      const priceOnlyFill = simulateFill({
        direction: pendingSignal.direction,
        requestedPrice: bar.open,
        quantity: 1,
        feeBps: strategy.costModel.feeBps,
        slippageBps: strategy.costModel.slippageBps,
        idempotencyKey: `bt:${strategy.id}:${i}:entry`,
      });
      const fillPrice = priceOnlyFill.fillPrice;
      const stopDistancePct = strategy.defaultStopLossPct / 100;
      const stopLoss = pendingSignal.direction === "LONG" ? fillPrice * (1 - stopDistancePct) : fillPrice * (1 + stopDistancePct);
      const takeProfit =
        pendingSignal.direction === "LONG" ? fillPrice * (1 + strategy.defaultTakeProfitPct / 100) : fillPrice * (1 - strategy.defaultTakeProfitPct / 100);
      const sizing = calculatePositionSize({ equity, entryPrice: fillPrice, stopLossPrice: stopLoss, riskPerTradePct });

      if (sizing.quantity > 0) {
        const entryFee = sizing.notional * (strategy.costModel.feeBps / 10000);
        openPosition = {
          direction: pendingSignal.direction,
          entryPrice: fillPrice,
          quantity: sizing.quantity,
          stopLoss,
          takeProfit,
          entryIndex: i,
          highestSinceEntry: bar.high,
          lowestSinceEntry: bar.low,
          mae: 0,
          mfe: 0,
        };
        equity -= entryFee;
      }
      pendingSignal = null;
    }

    // 3. Evaluate the strategy for a *new* signal using only data through this bar.
    if (!openPosition && !pendingSignal) {
      const features = computeLatestFeatures(window);
      if (features) {
        const regime = detectRegime(window);
        if (isRegimeCompatible(strategy.recommendedRegimes, regime.regime)) {
          let higherTrend: number | undefined;
          if (options?.higherTimeframeBars) {
            const htfWindow = options.higherTimeframeBars.filter((b) => b.timestamp <= bar.timestamp);
            const htfFeatures = htfWindow.length > 5 ? computeLatestFeatures(htfWindow) : null;
            higherTrend = htfFeatures?.trend;
          }
          const signal = strategy.evaluate(window, features, params, regime.regime, { higherTimeframeTrend: higherTrend });
          if (signal) {
            pendingSignal = { direction: signal.direction, fromIndex: i };
          }
        }
      }
    }

    const markPrice = bar.close;
    const unrealized = openPosition
      ? (openPosition.direction === "LONG" ? 1 : -1) * (markPrice - openPosition.entryPrice) * openPosition.quantity
      : 0;
    equityCurve.push({ t: bar.timestamp.getTime(), equity: equity + unrealized });
  }

  const metrics = computeBacktestMetrics(equityCurve, trades, initialEquity, bars);
  return { equityCurve, trades, metrics };
}

function computeBacktestMetrics(
  equityCurve: { t: number; equity: number }[],
  trades: BacktestTradeRecord[],
  initialEquity: number,
  bars: OHLCVBar[]
): BacktestMetrics {
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialEquity;
  const totalReturnPct = ((finalEquity - initialEquity) / initialEquity) * 100;

  const first = bars[0]?.timestamp.getTime();
  const last = bars[bars.length - 1]?.timestamp.getTime();
  const years = first && last ? (last - first) / (1000 * 60 * 60 * 24 * 365) : null;
  const cagrPct = years && years > 0 && finalEquity > 0 ? (Math.pow(finalEquity / initialEquity, 1 / years) - 1) * 100 : null;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) dailyReturns.push((equityCurve[i].equity - prev) / prev);
  }
  const mean = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length > 1 ? dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev === 0 ? null : (mean / stdDev) * Math.sqrt(252);

  const downside = dailyReturns.filter((r) => r < 0);
  const downsideStd = downside.length ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length) : 0;
  const sortino = downsideStd === 0 ? null : (mean / downsideStd) * Math.sqrt(252);

  let peak = initialEquity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const avgTradeReturnPct = trades.length
    ? (trades.reduce((s, t) => s + t.netPnl / (t.entryPrice * t.quantity), 0) / trades.length) * 100
    : 0;
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss;

  return { totalReturnPct, cagrPct, sharpe, sortino, maxDrawdownPct, winRate, trades: trades.length, avgTradeReturnPct, profitFactor, finalEquity };
}
