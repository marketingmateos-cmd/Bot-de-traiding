import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import { DemoAIProvider } from "@/lib/providers/ai/demo-provider";
import { getAIProvider } from "@/lib/providers/registry";
import type { AIAnalystInput, AIAnalystOutput, AICriticInput, AICriticOutput } from "@/lib/providers/types";
import type { ReplayAiMode } from "./types";

export interface AiModeResult {
  available: boolean;
  analyst: AIAnalystOutput | null;
  critic: AICriticOutput | null;
  availability: "REAL_HISTORICAL" | "DETERMINISTIC_SYNTHETIC" | "EXPERIMENTAL_LIVE" | "UNAVAILABLE";
}

// How close a real AIAnalysis row's createdAt must be to the replay
// timestamp to honestly count as "what the system actually thought at that
// moment" for FULL_HISTORICAL mode, rather than a coincidence.
const FULL_HISTORICAL_TOLERANCE_MS = 30 * 60_000;

const deterministicProvider = new DemoAIProvider();

/**
 * Fase 7B — the three AI modes, spelled out as one function each so the
 * caller (historicalReplayEngine.ts) never has to know which one is active
 * beyond calling `resolve*`. Every path returns an explicit `availability`
 * tag that flows straight into the decision record's audit trail — no path
 * here can silently invent a historical answer (spec rule #3).
 */

/** MODE 1 — only a REAL row the live system actually wrote at (near) this moment. Never reconstructed. */
export async function resolveFullHistorical(assetId: string, strategyKind: string, atMs: number): Promise<AiModeResult> {
  const strategyVersion = await prisma.strategyVersion.findFirst({ where: { strategy: { kind: strategyKind } } });
  const windowStart = new Date(atMs - FULL_HISTORICAL_TOLERANCE_MS);
  const windowEnd = new Date(atMs + FULL_HISTORICAL_TOLERANCE_MS);

  const [analystRow, criticRow] = await Promise.all([
    prisma.aIAnalysis.findFirst({
      where: { kind: "ANALYST", assetId, ...(strategyVersion ? { strategyVersionId: strategyVersion.id } : {}), createdAt: { gte: windowStart, lte: windowEnd } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.aIAnalysis.findFirst({
      where: { kind: "CRITIC", assetId, ...(strategyVersion ? { strategyVersionId: strategyVersion.id } : {}), createdAt: { gte: windowStart, lte: windowEnd } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!analystRow || !criticRow) {
    return { available: false, analyst: null, critic: null, availability: "UNAVAILABLE" };
  }
  return {
    available: true,
    analyst: fromJson<AIAnalystOutput | null>(analystRow.output, null),
    critic: fromJson<AICriticOutput | null>(criticRow.output, null),
    availability: "REAL_HISTORICAL",
  };
}

/** MODE 2 — pure, deterministic rule-based function of its input. Reproducible; explicitly not a real historical conversation. */
export async function resolveDeterministic(analystInput: AIAnalystInput): Promise<AiModeResult> {
  const analystResult = await deterministicProvider.analyze(analystInput);
  const criticResult = await deterministicProvider.critique({
    analyst: analystResult.output,
    context: analystInput,
    historicalStrategyStats: undefined,
  });
  return { available: true, analyst: analystResult.output, critic: criticResult.output, availability: "DETERMINISTIC_SYNTHETIC" };
}

/** MODE 3 — whatever AI provider is live-configured (demo or real Anthropic), called during the replay itself. Experimental, never historical. */
export async function resolveAiAssisted(analystInput: AIAnalystInput, criticInput: Omit<AICriticInput, "analyst" | "context">): Promise<AiModeResult> {
  const provider = getAIProvider();
  const analystResult = await provider.analyze(analystInput);
  const criticResult = await provider.critique({ analyst: analystResult.output, context: analystInput, ...criticInput });
  return { available: true, analyst: analystResult.output, critic: criticResult.output, availability: "EXPERIMENTAL_LIVE" };
}

export async function resolveAiForMode(
  mode: ReplayAiMode,
  assetId: string,
  strategyKind: string,
  atMs: number,
  analystInput: AIAnalystInput,
  historicalStrategyStats: AICriticInput["historicalStrategyStats"]
): Promise<AiModeResult> {
  if (mode === "FULL_HISTORICAL") return resolveFullHistorical(assetId, strategyKind, atMs);
  if (mode === "DETERMINISTIC_AI") return resolveDeterministic(analystInput);
  return resolveAiAssisted(analystInput, { historicalStrategyStats });
}
