import { prisma } from "@/lib/db";
import { tickPositions } from "@/lib/engines/positionLifecycle";
import { runPaperTradingScan } from "@/lib/paperTradingEngine";
import { createSystemAlert } from "@/lib/engines/alerts";
import { anyBreakerTripped } from "@/lib/engines/circuitBreakers";
import { computeAndRecordSystemHealth } from "@/lib/engines/systemHealth";

// The autonomous paper-trading loop (spec §6/§8/§45): this is what lets the
// bot open/close simulated positions without anyone pressing "scan". It only
// runs continuously on a persistent Node process — the Electron desktop app
// and a Render/Railway deploy both qualify, started once via
// src/instrumentation.ts when the server boots. On a serverless deploy
// (Vercel) there is no persistent process for setTimeout to survive between
// requests, so there autonomy would need a real external cron hitting an
// API route instead — not wired up, since the primary target right now is
// the desktop app.
//
// "NO TRADE IS A VALID DECISION" (spec §7): a cycle that finds nothing
// worth trading is not a failure — it's logged as WAITING, not forced into
// a trade.

const DEFAULT_ACCOUNT_ID = "main-paper-account";
let loopStarted = false;

export async function ensureBotConfig(id = "main") {
  return prisma.botConfig.upsert({
    where: { id },
    update: {},
    create: { id, accountId: DEFAULT_ACCOUNT_ID, isActive: true, status: "WAITING", intervalSeconds: 60 },
  });
}

async function setStatus(id: string, status: string, statusDetail: string) {
  await prisma.botConfig.update({ where: { id }, data: { status, statusDetail } });
}

/**
 * One full cycle: mark-to-market + stop/target checks always run (a paused
 * bot still manages risk on positions it already opened); the scan for new
 * opportunities only runs when the bot is switched ON.
 */
export async function runBotLoopOnce(id = "main") {
  const startedAt = Date.now();
  const config = await ensureBotConfig(id);
  const accountId = config.accountId;

  try {
    const account = await prisma.paperAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      await setStatus(id, "ERROR", "No se encontró la cuenta de paper trading.");
      return;
    }

    await setStatus(id, "ANALYZING", "Comprobando posiciones abiertas...");
    const tickResult = await tickPositions(accountId);

    if (!config.isActive) {
      await setStatus(id, "PAUSED", "El bot está en pausa — no se abrirán nuevas operaciones.");
      return;
    }

    if (account.isTradingBlocked) {
      await setStatus(id, "BLOCKED", account.blockedReason ?? "Trading bloqueado.");
      return;
    }

    const breakerStatus = await anyBreakerTripped();
    if (breakerStatus.tripped) {
      await setStatus(id, "BLOCKED", `Cortafuegos activo: ${breakerStatus.reasons.join(", ")}`);
      return;
    }

    await setStatus(id, "ANALYZING", "Buscando oportunidades en los mercados vigilados...");
    const results = await runPaperTradingScan(accountId);
    const opened = results.filter((r) => r.verdict === "APPROVED" || r.verdict === "LOW_CONFIDENCE").length;
    const withSignal = results.filter((r) => r.signal !== null).length;

    if (opened > 0) {
      await setStatus(id, "ACTIVE", `${opened} posición(es) abierta(s) en este ciclo.`);
    } else if (withSignal > 0) {
      await setStatus(
        id,
        "WAITING",
        `${withSignal} señal(es) detectada(s), ninguna superó el Trade Gate. Esperando una oportunidad mejor.`
      );
    } else {
      await setStatus(id, "WAITING", "Sin señales esta vuelta — esperando una oportunidad.");
    }

    if (tickResult.closed > 0) {
      await createSystemAlert({
        kind: "BOT_LOOP_TICK",
        severity: "INFO",
        title: "Posiciones cerradas automáticamente",
        message: `${tickResult.closed} posición(es) cerrada(s) por stop/objetivo en este ciclo.`,
      });
    }

    // Fase 2 fix: SystemHealth used to be a dead table, computed live only
    // when someone happened to have the System Health page open. Recording
    // it once per cycle here gives it a real, continuous history — never
    // allowed to break the main loop if it fails (best-effort telemetry).
    try {
      await computeAndRecordSystemHealth(accountId);
    } catch (err) {
      console.error("[botLoop] computeAndRecordSystemHealth failed", err);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setStatus(id, "ERROR", message);
    await createSystemAlert({ kind: "BOT_LOOP_ERROR", severity: "CRITICAL", title: "Error en el ciclo del bot", message });
  } finally {
    await prisma.botConfig.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastRunDurationMs: Date.now() - startedAt,
        nextRunAt: new Date(Date.now() + Math.max(5, config.intervalSeconds) * 1000),
      },
    });
  }
}

/** Starts the continuous loop once per server process. Safe to call multiple times. */
export function startBotLoop(id = "main") {
  if (loopStarted) return;
  loopStarted = true;

  const run = async () => {
    let intervalSeconds = 60;
    try {
      const config = await ensureBotConfig(id);
      intervalSeconds = config.intervalSeconds;
      await runBotLoopOnce(id);
    } catch (err) {
      console.error("[botLoop]", err);
    } finally {
      setTimeout(run, Math.max(5, intervalSeconds) * 1000);
    }
  };

  // Small initial delay so it doesn't race the server's very first request.
  setTimeout(run, 5000);
}
