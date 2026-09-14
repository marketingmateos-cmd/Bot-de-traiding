import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registerResearchDataset, DatasetValidationError } from "@/lib/research/researchDataset";
import type { TimeframeCode } from "@/lib/providers/types";

interface RegisterDatasetBody {
  symbol: string;
  timeframe: TimeframeCode;
  startDate: string;
  endDate: string;
  source: string;
}

/**
 * Fase 14 — Research Dataset Versioning. Registering a dataset never
 * fetches or generates data: it re-validates and hashes a slice of
 * `MarketData` that must ALREADY exist (imported via the existing
 * offlineImporter/live-API pipeline). Idempotent — POSTing the identical
 * (symbol, timeframe, startDate, endDate, source) twice returns the same
 * row (see `registerResearchDataset`'s own doc comment).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<RegisterDatasetBody>;
  if (!body.symbol || !body.timeframe || !body.startDate || !body.endDate || !body.source) {
    return NextResponse.json({ ok: false, error: "Missing required fields (symbol, timeframe, startDate, endDate, source)." }, { status: 400 });
  }
  if (body.source === "binance") {
    return NextResponse.json({ ok: false, error: '"binance" está reservado para la vía de la API en vivo — usa un source explícito como "binance_csv".' }, { status: 400 });
  }

  const startDate = new Date(body.startDate);
  const endDate = new Date(body.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return NextResponse.json({ ok: false, error: "Invalid date range." }, { status: 400 });
  }

  try {
    const dataset = await registerResearchDataset({ symbol: body.symbol.toUpperCase(), timeframe: body.timeframe, startDate, endDate, source: body.source });
    return NextResponse.json({ ok: true, dataset });
  } catch (err) {
    const message = err instanceof DatasetValidationError ? err.message : err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: err instanceof DatasetValidationError ? 400 : 500 });
  }
}

export async function GET() {
  const datasets = await prisma.researchDataset.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ ok: true, datasets });
}
