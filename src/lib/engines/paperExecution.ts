import { mulberry32, hashStringToSeed } from "@/lib/providers/market-data/seeded-random";

export interface FillRequest {
  direction: "LONG" | "SHORT";
  requestedPrice: number;
  quantity: number;
  feeBps: number;
  slippageBps: number;
  idempotencyKey: string; // used to seed deterministic "randomness" for reproducibility
}

export interface FillResult {
  fillPrice: number;
  filledQuantity: number;
  remainingQuantity: number;
  fee: number;
  slippageCost: number;
  isPartial: boolean;
  simulatedLatencyMs: number;
}

/**
 * Paper Execution Engine (spec §20). Never assumes a perfect fill: applies
 * spread/slippage as an adverse price adjustment, a fee on notional, a small
 * simulated latency, and occasionally a partial fill — deterministically
 * seeded per-order so a given order always reconstructs the same way
 * (spec §54, reproducibility).
 */
export function simulateFill(req: FillRequest): FillResult {
  const rand = mulberry32(hashStringToSeed(req.idempotencyKey));

  const spreadBps = 2 + rand() * 3; // simulated bid/ask spread
  const slippageBps = req.slippageBps * (0.5 + rand()); // stochastic around configured slippage
  const adverseBps = spreadBps + slippageBps;
  const direction = req.direction === "LONG" ? 1 : -1;
  const fillPrice = req.requestedPrice * (1 + (direction * adverseBps) / 10000);

  const partialRoll = rand();
  const isPartial = partialRoll < 0.08; // ~8% of orders fill partially in this simulation
  const filledQuantity = isPartial ? req.quantity * (0.5 + rand() * 0.4) : req.quantity;
  const remainingQuantity = req.quantity - filledQuantity;

  const notional = filledQuantity * fillPrice;
  const fee = notional * (req.feeBps / 10000);
  const slippageCost = Math.abs(fillPrice - req.requestedPrice) * filledQuantity;
  const simulatedLatencyMs = Math.round(80 + rand() * 400);

  return { fillPrice, filledQuantity, remainingQuantity, fee, slippageCost, isPartial, simulatedLatencyMs };
}

export interface StopCheckInput {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  currentHigh: number;
  currentLow: number;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopPct: number | null;
  highestSinceEntry: number; // for trailing stop on LONG
  lowestSinceEntry: number; // for trailing stop on SHORT
}

export interface StopCheckResult {
  triggered: boolean;
  exitPrice: number | null;
  reason: "STOP_LOSS" | "TAKE_PROFIT" | "TRAILING_STOP" | null;
}

/** Checks whether a bar's high/low would have triggered a stop/target — used by both paper trading and backtesting so the logic is identical (no divergence between live and backtest behavior). */
export function checkStopsAndTargets(input: StopCheckInput): StopCheckResult {
  const isLong = input.direction === "LONG";

  let effectiveStop = input.stopLoss;
  if (input.trailingStopPct !== null) {
    const trailFrom = isLong ? input.highestSinceEntry : input.lowestSinceEntry;
    const trailStop = isLong
      ? trailFrom * (1 - input.trailingStopPct / 100)
      : trailFrom * (1 + input.trailingStopPct / 100);
    effectiveStop = effectiveStop === null ? trailStop : isLong ? Math.max(effectiveStop, trailStop) : Math.min(effectiveStop, trailStop);
  }

  if (isLong) {
    if (effectiveStop !== null && input.currentLow <= effectiveStop) {
      return { triggered: true, exitPrice: effectiveStop, reason: effectiveStop === input.stopLoss ? "STOP_LOSS" : "TRAILING_STOP" };
    }
    if (input.takeProfit !== null && input.currentHigh >= input.takeProfit) {
      return { triggered: true, exitPrice: input.takeProfit, reason: "TAKE_PROFIT" };
    }
  } else {
    if (effectiveStop !== null && input.currentHigh >= effectiveStop) {
      return { triggered: true, exitPrice: effectiveStop, reason: effectiveStop === input.stopLoss ? "STOP_LOSS" : "TRAILING_STOP" };
    }
    if (input.takeProfit !== null && input.currentLow <= input.takeProfit) {
      return { triggered: true, exitPrice: input.takeProfit, reason: "TAKE_PROFIT" };
    }
  }

  return { triggered: false, exitPrice: null, reason: null };
}
