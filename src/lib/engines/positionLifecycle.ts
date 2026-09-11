import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/lib/providers/registry";
import { checkStopsAndTargets } from "./paperExecution";
import { closePosition } from "./positionStateManager";
import { runPostMortem } from "./postMortem";
import { createSystemAlert } from "./alerts";
import { logAudit } from "./auditLog";

/**
 * Mark-to-market + stop/target tick. Meant to be called frequently (a
 * "tick" API route the client polls, or a cron in a real deployment): marks
 * unrealized P&L on every open position and closes any that would have hit
 * their stop-loss/take-profit since the last tick, using the exact same
 * `checkStopsAndTargets` logic the backtester uses so paper trading and
 * backtesting can never silently disagree about what counts as a stop hit.
 */
export async function tickPositions(accountId: string) {
  const positions = await prisma.paperPosition.findMany({
    where: { accountId, status: { in: ["OPEN", "PARTIALLY_CLOSED"] } },
    include: { asset: true, strategyVersion: true },
  });

  const marketProvider = getMarketDataProvider();
  const closedTrades: string[] = [];

  for (const position of positions) {
    const latest = await marketProvider.getLatestPrice(position.asset.symbol);
    if (!latest) continue;

    const sign = position.direction === "LONG" ? 1 : -1;
    const unrealizedPnl = sign * (latest.price - position.entryPrice) * position.remainingQuantity;

    const stopCheck = checkStopsAndTargets({
      direction: position.direction,
      entryPrice: position.entryPrice,
      currentHigh: latest.price,
      currentLow: latest.price,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      trailingStopPct: position.trailingStopPct,
      highestSinceEntry: Math.max(position.entryPrice, latest.price),
      lowestSinceEntry: Math.min(position.entryPrice, latest.price),
    });

    if (stopCheck.triggered && stopCheck.exitPrice !== null) {
      const mae = Math.abs(Math.min(0, sign * (latest.price - position.entryPrice))) / position.entryPrice;
      const mfe = Math.max(0, sign * (latest.price - position.entryPrice)) / position.entryPrice;

      const snapshot = position.snapshot as { aiAnalysis?: { recommendation?: string }; regime?: { regime?: string } } | null;
      const hypothesisWasSound = snapshot?.aiAnalysis ? snapshot.aiAnalysis.recommendation === "APPROVE" : null;

      const { trade, netPnl } = await closePosition({
        positionId: position.id,
        exitPrice: stopCheck.exitPrice,
        reason: stopCheck.reason ?? "SIGNAL",
        feeBps: 10,
        mae,
        mfe,
        journalExtras: {
          indicators: snapshot ?? {},
          riskScore: undefined,
        },
      });

      const postMortem = runPostMortem({
        netPnl,
        hypothesisWasSound,
        regimeWasAppropriate: true,
        hadContradictingInformation: false,
        exitReason: stopCheck.reason ?? "SIGNAL",
        mae,
        stopLossFraction: position.stopLoss ? Math.abs(position.entryPrice - position.stopLoss) / position.entryPrice : null,
      });

      const journal = await prisma.tradeJournal.findUnique({ where: { tradeId: trade.id } });
      if (journal) {
        await prisma.postMortem.create({
          data: {
            journalId: journal.id,
            classification: postMortem.classification,
            hypothesisCorrect: hypothesisWasSound,
            notes: postMortem.notes,
          },
        });
      }

      await createSystemAlert({
        kind: stopCheck.reason === "TAKE_PROFIT" ? "TAKE_PROFIT_HIT" : "STOP_LOSS_HIT",
        severity: "INFO",
        title: `${stopCheck.reason} — ${position.asset.symbol}`,
        message: `Closed ${position.direction} position at ${stopCheck.exitPrice.toFixed(4)}, net P&L ${netPnl.toFixed(2)}.`,
      });
      await logAudit({ action: "PAPER_POSITION_CLOSED", entity: "PaperPosition", entityId: position.id, data: { reason: stopCheck.reason, netPnl } });
      closedTrades.push(trade.id);
    } else {
      await prisma.paperPosition.update({ where: { id: position.id }, data: { unrealizedPnl } });
    }
  }

  return { checked: positions.length, closed: closedTrades.length };
}
