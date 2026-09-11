import { NextResponse } from "next/server";
import { tickPositions } from "@/lib/engines/positionLifecycle";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const accountId = body.accountId ?? "main-paper-account";
  try {
    const result = await tickPositions(accountId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
