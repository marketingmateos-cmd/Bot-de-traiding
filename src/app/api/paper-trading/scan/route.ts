import { NextResponse } from "next/server";
import { runPaperTradingScan } from "@/lib/paperTradingEngine";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const accountId = body.accountId ?? "main-paper-account";
  try {
    const results = await runPaperTradingScan(accountId);
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
