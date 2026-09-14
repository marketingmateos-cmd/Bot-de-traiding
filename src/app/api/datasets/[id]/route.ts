import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildDatasetManifest, buildDatasetProvenance } from "@/lib/research/researchDataset";

/** Fase 14 spec section 7 — the manifest, consultable from the app: this row's own frozen identity, never re-derived from MarketData at read time. Fase 16 adds `provenance` (spec section 11): which MarketDataImportLog entries actually built this range, computed fresh at read time (see buildDatasetProvenance's own doc comment for why it's never stored on the row itself). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataset = await prisma.researchDataset.findUnique({ where: { id } });
  if (!dataset) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const provenance = await buildDatasetProvenance(dataset);
  return NextResponse.json({ ok: true, dataset, manifest: buildDatasetManifest(dataset), provenance });
}
