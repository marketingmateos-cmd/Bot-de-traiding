import { NextResponse } from "next/server";
import { ensureBotConfig } from "@/lib/botLoop";

export async function GET() {
  const config = await ensureBotConfig();
  return NextResponse.json({ ok: true, config });
}
