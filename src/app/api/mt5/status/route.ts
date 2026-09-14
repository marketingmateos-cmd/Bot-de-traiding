import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConnectionRow, toPublicView } from "@/lib/execution/mt5ConnectionStore";

export async function GET() {
  const [row, lastEvent] = await Promise.all([
    getConnectionRow(),
    prisma.executionEvent.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);
  return NextResponse.json({
    ok: true,
    connection: toPublicView(row),
    lastExecutionEvent: lastEvent
      ? {
          symbol: lastEvent.symbol,
          side: lastEvent.side,
          status: lastEvent.status,
          approvedVolume: lastEvent.approvedVolume,
          mt5Ticket: lastEvent.mt5Ticket,
          rejectionReason: lastEvent.rejectionReason,
          failedCheck: lastEvent.failedCheck,
          createdAt: lastEvent.createdAt,
        }
      : null,
  });
}
