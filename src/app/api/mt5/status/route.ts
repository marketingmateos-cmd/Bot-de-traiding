import { NextResponse } from "next/server";
import { getConnectionRow, toPublicView } from "@/lib/execution/mt5ConnectionStore";

export async function GET() {
  const row = await getConnectionRow();
  return NextResponse.json({ ok: true, connection: toPublicView(row) });
}
