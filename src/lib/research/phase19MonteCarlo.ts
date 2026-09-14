import { mulberry32 } from "@/lib/providers/market-data/seeded-random";
import { evaluateBenchmarkRun, type BenchmarkEvaluationProfile } from "./benchmarkEvaluation";
import { computeDescriptiveResearchStats } from "./researchStrategyStats";
import type { ReplayTradeRecord } from "@/lib/replay/types";
import type { StressScenario } from "./phase19PreRegistration";

/**
 * Fase 19 — Robustness, Monte Carlo & Stress Testing. Every function here
 * is PURE post-processing over an ALREADY-simulated `ReplayTradeRecord[]`
 * (Fase 18's own output) — nothing here re-runs a strategy, re-fetches
 * market data, or touches the Risk/Evaluation Engine's own logic (it only
 * CALLS `evaluateBenchmarkRun`, Fase 11's unmodified function, as an
 * analysis lens over a simulated equity curve — same reuse pattern Fase 11
 * itself already established).
 *
 * Bootstrap methodology (spec section 4/6): for a trade set of N trades
 * chronologically ordered by `exitTime`, each simulation draws N indices
 * WITH REPLACEMENT from that same set and applies trade `j`'s `netPnl` at
 * POSITION `i`'s own original timestamp — i.e. the real calendar
 * frequency/spacing of trades is preserved exactly (so day-boundary daily
 * loss limits remain meaningful) while WHICH dollar outcome lands on which
 * day is resampled. This is the standard trade-bootstrap convention; nsew
 * dollar values are never invented — every value that can appear in a
 * simulation already appears, verbatim, in the real observed trades.
 */

export interface PercentileSet {
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  mean: number;
  median: number;
  stdDev: number;
}

export interface MonteCarloAggregate {
  iterations: number;
  seed: number;
  tradesPerSimulation: number;
  finalReturnPct: PercentileSet;
  maxDrawdownPct: PercentileSet;
  losingStreak: { p50: number; p75: number; p90: number; p95: number; max: number };
  probabilities: {
    returnPositive: number;
    returnAtLeast3Pct: number;
    returnAtLeast5Pct: number;
    maxDrawdownOver5Pct: number;
    maxDrawdownOver10Pct: number;
    maxDrawdownOver15Pct: number;
    maxDrawdownOver20Pct: number;
    ruin: number; // equity ever <= (1 - ruinThresholdPct/100) * initialEquity
    loss: number; // final equity < initial equity
  };
  riskOfFailure: {
    hitDailySafety: number; // empirical simulated frequency dailyStopTriggered was true
    hitTotalSafety: number; // empirical simulated frequency totalStopTriggered was true
    targetReached: number; // empirical simulated frequency evaluation status === PASS
  };
  /** Where the REAL, non-resampled observed max losing streak ranks within the simulated distribution (0-100), and the observed value itself — a diagnostic for spec section 19 (trade dependency), not a probability claim. */
  observedMaxLosingStreakPercentileRank: number;
  observedMaxLosingStreak: number;
}

function sortedPercentiles(values: number[]): PercentileSet {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number) => {
    if (n === 0) return 0;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((p / 100) * n)));
    return sorted[idx];
  };
  const mean = n === 0 ? 0 : sorted.reduce((a, b) => a + b, 0) / n;
  const median = pct(50);
  const variance = n === 0 ? 0 : sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { p5: pct(5), p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90), p95: pct(95), mean, median, stdDev: Math.sqrt(variance) };
}

function computeMaxLosingStreak(pnls: number[]): number {
  let cur = 0;
  let max = 0;
  for (const p of pnls) {
    if (p < 0) {
      cur++;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function percentileRankOf(value: number, distribution: number[]): number {
  if (distribution.length === 0) return 0;
  const countBelowOrEqual = distribution.filter((v) => v <= value).length;
  return (countBelowOrEqual / distribution.length) * 100;
}

/**
 * Spec section 3/13 — applies a cost stress scenario to already-observed
 * trades WITHOUT re-simulating fills/SL/TP: `netPnl` is adjusted by the
 * INCREMENTAL extra fee/slippage cost implied by the multiplier, applied
 * directly to the trade's own already-realized `fees`/`slippageCost`
 * fields. At multiplier 1/1 (the BASE scenario) this is an exact identity
 * — reproduces the original `netPnl` unchanged, never approximately.
 * Explicitly NOT a re-simulation: a real slippage increase could also
 * shift which trades hit their stop vs. target (a second-order execution
 * effect), which this diagnostic overlay does not attempt to model —
 * documented here rather than silently assumed away.
 */
export function applyCostStress(trades: ReplayTradeRecord[], scenario: StressScenario): ReplayTradeRecord[] {
  return trades.map((t) => {
    const extraFees = t.fees * (scenario.feeMultiplier - 1);
    const extraSlippage = t.slippageCost * (scenario.slippageMultiplier - 1);
    return { ...t, netPnl: t.netPnl - extraFees - extraSlippage };
  });
}

export interface BootstrapOptions {
  iterations: number;
  seed: number;
  initialEquity: number;
  evaluationProfile: BenchmarkEvaluationProfile;
  ruinThresholdPct: number;
  returnThresholdsPct: readonly number[];
  drawdownThresholdsPct: readonly number[];
}

/** Spec sections 4/6/7/8/9/10 — the core bootstrap. `trades` must already be chronologically ordered by `exitTime` (callers are responsible — every Fase 18 segment already is). */
export function runBootstrapMonteCarlo(trades: ReplayTradeRecord[], options: BootstrapOptions): MonteCarloAggregate {
  const n = trades.length;
  const rand = mulberry32(options.seed);
  const exitTimesMs = trades.map((t) => new Date(t.exitTime).getTime());
  const netPnls = trades.map((t) => t.netPnl);

  const finalReturns: number[] = [];
  const maxDrawdowns: number[] = [];
  const losingStreaks: number[] = [];
  let ruinCount = 0;
  let lossCount = 0;
  let dailySafetyCount = 0;
  let totalSafetyCount = 0;
  let targetReachedCount = 0;
  const returnHitCounts = options.returnThresholdsPct.map(() => 0);
  const ddHitCounts = options.drawdownThresholdsPct.map(() => 0);

  for (let iter = 0; iter < options.iterations; iter++) {
    let equity = options.initialEquity;
    let peak = options.initialEquity;
    let maxDd = 0;
    let ruined = false;
    const equityCurve: { t: number; equity: number }[] = new Array(n);
    const simulatedPnls: number[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const j = n === 0 ? 0 : Math.floor(rand() * n);
      const pnl = netPnls[j];
      simulatedPnls[i] = pnl;
      equity += pnl;
      peak = Math.max(peak, equity);
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      maxDd = Math.max(maxDd, dd);
      if (equity <= options.initialEquity * (1 - options.ruinThresholdPct / 100)) ruined = true;
      equityCurve[i] = { t: exitTimesMs[i], equity };
    }

    const returnPct = n === 0 ? 0 : ((equity - options.initialEquity) / options.initialEquity) * 100;
    finalReturns.push(returnPct);
    maxDrawdowns.push(maxDd);
    losingStreaks.push(computeMaxLosingStreak(simulatedPnls));
    if (ruined) ruinCount++;
    if (returnPct < 0) lossCount++;
    options.returnThresholdsPct.forEach((thr, idx) => {
      if (returnPct >= thr) returnHitCounts[idx]++;
    });
    options.drawdownThresholdsPct.forEach((thr, idx) => {
      if (maxDd > thr) ddHitCounts[idx]++;
    });

    if (n > 0) {
      const evalResult = evaluateBenchmarkRun(equityCurve, options.evaluationProfile);
      if (evalResult.dailyStopTriggered) dailySafetyCount++;
      if (evalResult.totalStopTriggered) totalSafetyCount++;
      if (evalResult.status === "PASS") targetReachedCount++;
    }
  }

  const losingStreakPct = sortedPercentiles(losingStreaks);
  const observedMaxLosingStreak = computeMaxLosingStreak(netPnls);

  const [p0, p3, p5] = options.returnThresholdsPct.map((_, i) => returnHitCounts[i] / options.iterations);
  const [d5, d10, d15, d20] = options.drawdownThresholdsPct.map((_, i) => ddHitCounts[i] / options.iterations);

  return {
    iterations: options.iterations,
    seed: options.seed,
    tradesPerSimulation: n,
    finalReturnPct: sortedPercentiles(finalReturns),
    maxDrawdownPct: sortedPercentiles(maxDrawdowns),
    losingStreak: { p50: losingStreakPct.p50, p75: losingStreakPct.p75, p90: losingStreakPct.p90, p95: losingStreakPct.p95, max: losingStreaks.length ? Math.max(...losingStreaks) : 0 },
    probabilities: {
      returnPositive: p0 ?? 0,
      returnAtLeast3Pct: p3 ?? 0,
      returnAtLeast5Pct: p5 ?? 0,
      maxDrawdownOver5Pct: d5 ?? 0,
      maxDrawdownOver10Pct: d10 ?? 0,
      maxDrawdownOver15Pct: d15 ?? 0,
      maxDrawdownOver20Pct: d20 ?? 0,
      ruin: ruinCount / options.iterations,
      loss: lossCount / options.iterations,
    },
    riskOfFailure: {
      hitDailySafety: dailySafetyCount / options.iterations,
      hitTotalSafety: totalSafetyCount / options.iterations,
      targetReached: targetReachedCount / options.iterations,
    },
    observedMaxLosingStreakPercentileRank: percentileRankOf(observedMaxLosingStreak, losingStreaks),
    observedMaxLosingStreak,
  };
}

/**
 * Spec section 20 — block bootstrap: resamples CONTIGUOUS blocks of
 * `blockSize` consecutive (chronologically-ordered) trades with
 * replacement, instead of single trades, to partially preserve local
 * temporal clustering. Blocks are drawn until at least `n` trades are
 * filled (the final block is truncated to fit exactly `n`, never padded
 * with fabricated values). `blockSize` is a FIXED, pre-registered constant
 * (`FROZEN_BLOCK_SIZE`) — never chosen per strategy or after seeing results.
 */
export function runBlockBootstrapMonteCarlo(trades: ReplayTradeRecord[], blockSize: number, options: BootstrapOptions): MonteCarloAggregate {
  const n = trades.length;
  const rand = mulberry32(options.seed);
  const exitTimesMs = trades.map((t) => new Date(t.exitTime).getTime());
  const netPnls = trades.map((t) => t.netPnl);
  const numBlockStarts = Math.max(1, n - blockSize + 1);

  const finalReturns: number[] = [];
  const maxDrawdowns: number[] = [];
  const losingStreaks: number[] = [];
  let ruinCount = 0;
  let lossCount = 0;
  let dailySafetyCount = 0;
  let totalSafetyCount = 0;
  let targetReachedCount = 0;
  const returnHitCounts = options.returnThresholdsPct.map(() => 0);
  const ddHitCounts = options.drawdownThresholdsPct.map(() => 0);

  for (let iter = 0; iter < options.iterations; iter++) {
    let equity = options.initialEquity;
    let peak = options.initialEquity;
    let maxDd = 0;
    let ruined = false;
    const equityCurve: { t: number; equity: number }[] = [];
    const simulatedPnls: number[] = [];

    while (simulatedPnls.length < n) {
      const blockStart = Math.floor(rand() * numBlockStarts);
      const remaining = n - simulatedPnls.length;
      const take = Math.min(blockSize, remaining);
      for (let k = 0; k < take; k++) {
        const pnl = netPnls[blockStart + k];
        simulatedPnls.push(pnl);
        equity += pnl;
        peak = Math.max(peak, equity);
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        maxDd = Math.max(maxDd, dd);
        if (equity <= options.initialEquity * (1 - options.ruinThresholdPct / 100)) ruined = true;
        equityCurve.push({ t: exitTimesMs[simulatedPnls.length - 1], equity });
      }
    }

    const returnPct = n === 0 ? 0 : ((equity - options.initialEquity) / options.initialEquity) * 100;
    finalReturns.push(returnPct);
    maxDrawdowns.push(maxDd);
    losingStreaks.push(computeMaxLosingStreak(simulatedPnls));
    if (ruined) ruinCount++;
    if (returnPct < 0) lossCount++;
    options.returnThresholdsPct.forEach((thr, idx) => {
      if (returnPct >= thr) returnHitCounts[idx]++;
    });
    options.drawdownThresholdsPct.forEach((thr, idx) => {
      if (maxDd > thr) ddHitCounts[idx]++;
    });

    if (n > 0) {
      const evalResult = evaluateBenchmarkRun(equityCurve, options.evaluationProfile);
      if (evalResult.dailyStopTriggered) dailySafetyCount++;
      if (evalResult.totalStopTriggered) totalSafetyCount++;
      if (evalResult.status === "PASS") targetReachedCount++;
    }
  }

  const losingStreakPct = sortedPercentiles(losingStreaks);
  const observedMaxLosingStreak = computeMaxLosingStreak(netPnls);
  const [p0, p3, p5] = options.returnThresholdsPct.map((_, i) => returnHitCounts[i] / options.iterations);
  const [d5, d10, d15, d20] = options.drawdownThresholdsPct.map((_, i) => ddHitCounts[i] / options.iterations);

  return {
    iterations: options.iterations,
    seed: options.seed,
    tradesPerSimulation: n,
    finalReturnPct: sortedPercentiles(finalReturns),
    maxDrawdownPct: sortedPercentiles(maxDrawdowns),
    losingStreak: { p50: losingStreakPct.p50, p75: losingStreakPct.p75, p90: losingStreakPct.p90, p95: losingStreakPct.p95, max: losingStreaks.length ? Math.max(...losingStreaks) : 0 },
    probabilities: {
      returnPositive: p0 ?? 0,
      returnAtLeast3Pct: p3 ?? 0,
      returnAtLeast5Pct: p5 ?? 0,
      maxDrawdownOver5Pct: d5 ?? 0,
      maxDrawdownOver10Pct: d10 ?? 0,
      maxDrawdownOver15Pct: d15 ?? 0,
      maxDrawdownOver20Pct: d20 ?? 0,
      ruin: ruinCount / options.iterations,
      loss: lossCount / options.iterations,
    },
    riskOfFailure: {
      hitDailySafety: dailySafetyCount / options.iterations,
      hitTotalSafety: totalSafetyCount / options.iterations,
      targetReached: targetReachedCount / options.iterations,
    },
    observedMaxLosingStreakPercentileRank: percentileRankOf(observedMaxLosingStreak, losingStreaks),
    observedMaxLosingStreak,
  };
}

export interface OutlierAnalysis {
  bestTrade: number | null;
  worstTrade: number | null;
  top5Gains: number[];
  top5Losses: number[];
  top5GainsContributionPct: number | null; // % of total gross profit
  worstTradeContributionPct: number | null; // % of total net P&L magnitude
  totalNetPnl: number;
}

/** Spec section 17 — descriptive only, never removes anything. */
export function computeOutlierAnalysis(trades: ReplayTradeRecord[]): OutlierAnalysis {
  if (trades.length === 0) {
    return { bestTrade: null, worstTrade: null, top5Gains: [], top5Losses: [], top5GainsContributionPct: null, worstTradeContributionPct: null, totalNetPnl: 0 };
  }
  const pnls = trades.map((t) => t.netPnl);
  const sorted = [...pnls].sort((a, b) => b - a);
  const top5Gains = sorted.slice(0, 5);
  const top5Losses = sorted.slice(-5).reverse();
  const totalNetPnl = pnls.reduce((a, b) => a + b, 0);
  const totalGrossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const top5GainsSum = top5Gains.filter((p) => p > 0).reduce((a, b) => a + b, 0);

  return {
    bestTrade: sorted[0],
    worstTrade: sorted[sorted.length - 1],
    top5Gains,
    top5Losses,
    top5GainsContributionPct: totalGrossProfit > 0 ? (top5GainsSum / totalGrossProfit) * 100 : null,
    worstTradeContributionPct: totalNetPnl !== 0 ? (Math.abs(sorted[sorted.length - 1]) / Math.abs(totalNetPnl)) * 100 : null,
    totalNetPnl,
  };
}

export interface ExpectancyStats {
  meanR: number | null;
  medianR: number | null;
  tradeCount: number;
}

/** Spec section 18 — reuses Fase 17's own R-multiple computation unchanged (never re-derived). */
export function computeExpectancyStats(trades: ReplayTradeRecord[]): ExpectancyStats {
  const stats = computeDescriptiveResearchStats(trades, []);
  return { meanR: stats.avgR, medianR: stats.medianR, tradeCount: trades.length };
}

export type RobustnessClassification = "ROBUST" | "FRAGILE" | "NEGATIVE_ROBUST" | "INCONCLUSIVE";

export interface RobustnessResult {
  classification: RobustnessClassification;
  reasoning: string[];
}

/**
 * Spec section 23 — a fixed, pre-specified rule, never adjusted per
 * strategy. Compares the BASE Monte Carlo distribution against the
 * heaviest stress scenario (fees+50%+slippage+50%) already computed.
 * NEGATIVE_ROBUST requires the observed (non-simulated) result to have
 * been unfavorable in the first place (spec: never call a strategy whose
 * original evidence was negative "ROBUST").
 */
export function classifyRobustness(baseAggregate: MonteCarloAggregate, heaviestStressAggregate: MonteCarloAggregate, originalObservedReturnPct: number, sampleSize: number, minSampleSize: number): RobustnessResult {
  const reasoning: string[] = [];
  if (sampleSize < minSampleSize) {
    reasoning.push(`Muestra de ${sampleSize} trades, por debajo de MIN_SAMPLE_SIZE (${minSampleSize}) — no se puede concluir robustez ni fragilidad con esta muestra.`);
    return { classification: "INCONCLUSIVE", reasoning };
  }

  const baseMedianNegative = baseAggregate.finalReturnPct.median <= 0;
  const stressMedianNegative = heaviestStressAggregate.finalReturnPct.median <= 0;

  if (originalObservedReturnPct <= 0 && baseMedianNegative && stressMedianNegative) {
    reasoning.push("El resultado observado fue negativo, la mediana simulada BASE es negativa, y sigue siendo negativa incluso bajo el escenario de stress más severo (fees+50%+slippage+50%) — el comportamiento desfavorable es consistente y no depende de una secuencia concreta.");
    return { classification: "NEGATIVE_ROBUST", reasoning };
  }

  if (originalObservedReturnPct > 0 && !baseMedianNegative && !stressMedianNegative) {
    reasoning.push("El resultado observado fue positivo, la mediana simulada BASE es positiva, y sigue siendo positiva bajo el escenario de stress más severo — comportamiento consistente bajo variaciones razonables.");
    return { classification: "ROBUST", reasoning };
  }

  if (baseMedianNegative !== stressMedianNegative) {
    reasoning.push("El signo de la mediana simulada cambia entre el escenario BASE y el de stress más severo — el resultado es sensible a costes/slippage.");
    return { classification: "FRAGILE", reasoning };
  }

  reasoning.push("Resultado mixto entre lo observado y lo simulado que no encaja de forma clara en ROBUST/FRAGILE/NEGATIVE_ROBUST.");
  return { classification: "INCONCLUSIVE", reasoning };
}
