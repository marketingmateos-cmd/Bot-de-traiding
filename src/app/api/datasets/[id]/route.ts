import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildDatasetManifest } from "@/lib/research/researchDataset";

/** Fase 14 spec section 7 — the manifest, consultable from the app: this row's own frozen identity, never re-derived from MarketData at read time. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataset = await prisma.researchDataset.findUnique({ where: { id } });
  if (!dataset) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, dataset, manifest: buildDatasetManifest(dataset) });
}
