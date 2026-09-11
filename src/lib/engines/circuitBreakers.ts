import { prisma } from "@/lib/db";
import { createSystemAlert } from "./alerts";
import { logAudit } from "./auditLog";

/**
 * Circuit Breakers (spec §22). Independent emergency mechanisms that block
 * new simulated trades outright when tripped, regardless of what the
 * strategy/AI layers say. Deliberately conservative: false positives (an
 * unnecessary block) are cheap, false negatives are not.
 */

export interface CircuitBreakerCheckContext {
  accountId: string;
  dailyPnlPct: number;
  currentDrawdownPct: number;
  tradesToday: number;
  dataQualityScore: number;
  apiHealthy: boolean;
  positionsConsistent: boolean;
}

export interface BreakerDefinition {
  name: string;
  kind: string;
  evaluate(ctx: CircuitBreakerCheckContext): { tripped: boolean; reason?: string };
}

const MAX_DAILY_LOSS_PCT = 5;
const MAX_DRAWDOWN_PCT = 20;
const MAX_TRADES_PER_DAY = 25;
const MIN_DATA_QUALITY = 55;

export const BREAKERS: BreakerDefinition[] = [
  {
    name: "max-daily-loss",
    kind: "MAX_DAILY_LOSS",
    evaluate: (ctx) =>
      ctx.dailyPnlPct <= -MAX_DAILY_LOSS_PCT
        ? { tripped: true, reason: `El P&L diario (${ctx.dailyPnlPct.toFixed(2)}%) superó el límite de -${MAX_DAILY_LOSS_PCT}%.` }
        : { tripped: false },
  },
  {
    name: "max-drawdown",
    kind: "MAX_DRAWDOWN",
    evaluate: (ctx) =>
      ctx.currentDrawdownPct >= MAX_DRAWDOWN_PCT
        ? { tripped: true, reason: `El drawdown (${ctx.currentDrawdownPct.toFixed(2)}%) superó el límite del ${MAX_DRAWDOWN_PCT}%.` }
        : { tripped: false },
  },
  {
    name: "max-trades",
    kind: "MAX_TRADES",
    evaluate: (ctx) =>
      ctx.tradesToday >= MAX_TRADES_PER_DAY
        ? { tripped: true, reason: `${ctx.tradesToday} operaciones hoy alcanzaron el límite diario de ${MAX_TRADES_PER_DAY}.` }
        : { tripped: false },
  },
  {
    name: "data-corruption",
    kind: "DATA_CORRUPTION",
    evaluate: (ctx) =>
      ctx.dataQualityScore < MIN_DATA_QUALITY
        ? { tripped: true, reason: `La puntuación de calidad de datos (${ctx.dataQualityScore}) está por debajo del mínimo ${MIN_DATA_QUALITY}.` }
        : { tripped: false },
  },
  {
    name: "api-down",
    kind: "API_DOWN",
    evaluate: (ctx) => (!ctx.apiHealthy ? { tripped: true, reason: "Una o más fuentes de datos necesarias no están funcionando correctamente." } : { tripped: false }),
  },
  {
    name: "position-inconsistency",
    kind: "POSITION_INCONSISTENCY",
    evaluate: (ctx) =>
      !ctx.positionsConsistent ? { tripped: true, reason: "La reconciliación del estado de posiciones encontró inconsistencias." } : { tripped: false },
  },
];

export async function evaluateCircuitBreakers(ctx: CircuitBreakerCheckContext) {
  const results: { name: string; tripped: boolean; reason?: string }[] = [];

  for (const breaker of BREAKERS) {
    const result = breaker.evaluate(ctx);
    results.push({ name: breaker.name, ...result });

    const existing = await prisma.circuitBreaker.findUnique({ where: { name: breaker.name } });
    if (result.tripped && (!existing || !existing.isTripped)) {
      await prisma.circuitBreaker.upsert({
        where: { name: breaker.name },
        create: {
          name: breaker.name,
          kind: breaker.kind,
          threshold: {},
          isTripped: true,
          trippedAt: new Date(),
          trippedReason: result.reason,
        },
        update: { isTripped: true, trippedAt: new Date(), trippedReason: result.reason },
      });
      await createSystemAlert({
        kind: "CIRCUIT_BREAKER",
        severity: "CRITICAL",
        title: `Cortafuegos activado: ${breaker.name}`,
        message: result.reason ?? "Se superó el umbral.",
      });
      await logAudit({ action: "CIRCUIT_BREAKER_TRIPPED", entity: "CircuitBreaker", entityId: breaker.name, data: result });
    } else if (!result.tripped && existing?.isTripped) {
      // Auto-recovery only for transient conditions like API health / data
      // quality; loss & drawdown breakers require an explicit manual reset
      // (handled in Settings) since "the loss already happened" doesn't un-happen.
      if (breaker.kind === "API_DOWN" || breaker.kind === "DATA_CORRUPTION" || breaker.kind === "POSITION_INCONSISTENCY") {
        await prisma.circuitBreaker.update({ where: { name: breaker.name }, data: { isTripped: false, resetAt: new Date() } });
      }
    }
  }

  return results;
}

export async function anyBreakerTripped(): Promise<{ tripped: boolean; reasons: string[] }> {
  const tripped = await prisma.circuitBreaker.findMany({ where: { isTripped: true } });
  return { tripped: tripped.length > 0, reasons: tripped.map((b) => `${b.name}: ${b.trippedReason ?? "tripped"}`) };
}

export async function resetCircuitBreaker(name: string) {
  await prisma.circuitBreaker.update({ where: { name }, data: { isTripped: false, resetAt: new Date(), trippedReason: null } });
  await logAudit({ action: "CIRCUIT_BREAKER_RESET", entity: "CircuitBreaker", entityId: name });
}
