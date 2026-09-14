import { hashStringToSeed } from "@/lib/providers/market-data/seeded-random";
import type { StrategyParams } from "@/lib/engines/strategy/types";

/**
 * Fase 11, spec section 20 — reproducibility. A stable (never cryptographic
 * — this is an identity check, not a security boundary) hash of a
 * strategy's id + version + exact parameter values, so two benchmark runs
 * of "the same strategy" can be told apart the moment either changes. Keys
 * are sorted before hashing so `{a:1,b:2}` and `{b:2,a:1}` — the same
 * config, different insertion order — hash identically.
 */
export function computeStrategyConfigHash(strategyId: string, version: string, params: StrategyParams): string {
  const sortedKeys = Object.keys(params).sort();
  const canonical = JSON.stringify({ strategyId, version, params: sortedKeys.map((k) => [k, params[k]]) });
  return (hashStringToSeed(canonical) >>> 0).toString(16).padStart(8, "0");
}
