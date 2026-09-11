import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// Rough, conservative per-1K-token pricing estimate for budget purposes only
// (not billing-accurate — just enough to keep a running estimate visible).
const COST_PER_1K_INPUT_USD = 0.003;
const COST_PER_1K_OUTPUT_USD = 0.015;

function startOfDayUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface BudgetStatus {
  callsToday: number;
  dailyBudget: number;
  budgetRemainingPct: number;
  monthlyCostUsd: number;
  monthlyCostBudgetUsd: number;
  cacheHitRate: number;
  shouldThrottle: boolean; // true when close to budget: skip non-critical AI calls
  shouldUseCacheOnly: boolean; // true when budget exhausted: never call out
}

/**
 * AI Usage / Budget Manager (spec §36). Tracks calls/tokens/cost per day and
 * degrades gracefully as usage approaches configured limits — never lets a
 * quota exhaustion crash the app; callers are expected to check
 * `shouldThrottle` / `shouldUseCacheOnly` before deciding whether to call the
 * AI Analyst/Critic for a non-critical (e.g. background research) request.
 */
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const day = startOfDayUtc();
  const usage = await prisma.aIUsage.findUnique({ where: { day } });

  const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  const monthUsage = await prisma.aIUsage.aggregate({
    where: { day: { gte: monthStart } },
    _sum: { estimatedCost: true, cacheHits: true, cacheMisses: true },
  });

  const callsToday = usage?.callsCount ?? 0;
  const monthlyCostUsd = monthUsage._sum.estimatedCost ?? 0;
  const hits = monthUsage._sum.cacheHits ?? 0;
  const misses = monthUsage._sum.cacheMisses ?? 0;
  const cacheHitRate = hits + misses > 0 ? hits / (hits + misses) : 0;

  const budgetRemainingPct = Math.max(0, 100 - (callsToday / env.aiDailyCallBudget) * 100);

  return {
    callsToday,
    dailyBudget: env.aiDailyCallBudget,
    budgetRemainingPct,
    monthlyCostUsd,
    monthlyCostBudgetUsd: env.aiMonthlyCostBudgetUsd,
    cacheHitRate,
    shouldThrottle: budgetRemainingPct < 20 || monthlyCostUsd > env.aiMonthlyCostBudgetUsd * 0.8,
    shouldUseCacheOnly: callsToday >= env.aiDailyCallBudget || monthlyCostUsd >= env.aiMonthlyCostBudgetUsd,
  };
}

export async function recordAIUsage(input: { tokensIn: number; tokensOut: number; cached: boolean }) {
  const day = startOfDayUtc();
  const cost = input.cached ? 0 : (input.tokensIn / 1000) * COST_PER_1K_INPUT_USD + (input.tokensOut / 1000) * COST_PER_1K_OUTPUT_USD;

  await prisma.aIUsage.upsert({
    where: { day },
    create: {
      day,
      callsCount: 1,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      estimatedCost: cost,
      cacheHits: input.cached ? 1 : 0,
      cacheMisses: input.cached ? 0 : 1,
    },
    update: {
      callsCount: { increment: 1 },
      tokensIn: { increment: input.tokensIn },
      tokensOut: { increment: input.tokensOut },
      estimatedCost: { increment: cost },
      cacheHits: { increment: input.cached ? 1 : 0 },
      cacheMisses: { increment: input.cached ? 0 : 1 },
    },
  });

  return cost;
}

// Simple in-memory cache for AI analyses keyed by a caller-supplied
// fingerprint (e.g. symbol+timeframe+regime+signal hash), so repeated
// analyses of an unchanged setup don't re-spend budget.
const analysisCache = new Map<string, { value: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

export function getCached<T>(key: string): T | null {
  const entry = analysisCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    analysisCache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached(key: string, value: unknown) {
  analysisCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}
