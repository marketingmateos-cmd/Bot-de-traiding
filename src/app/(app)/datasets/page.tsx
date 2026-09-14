import { prisma } from "@/lib/db";
import { DatasetsForm } from "@/components/datasets/DatasetsForm";

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  const assets = await prisma.asset.findMany({ where: { isActive: true }, orderBy: { symbol: "asc" } });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Datasets</h1>
        <p className="mt-1 text-sm text-muted">
          Fase 14 — registro versionado y reproducible de datasets de investigación. Registrar un dataset NUNCA descarga, genera ni rellena velas — solo
          valida y calcula el hash de velas que ya existen en <code>MarketData</code> (importadas vía CSV real u API en vivo). Un dataset registrado puede
          seleccionarse para Strategy Benchmark / Hypothesis Validation en <a href="/strategy-lab" className="underline">/strategy-lab</a>.
        </p>
      </div>

      <DatasetsForm assetSymbols={assets.map((a) => a.symbol)} />
    </div>
  );
}
