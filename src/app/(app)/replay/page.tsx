import { prisma } from "@/lib/db";
import { STRATEGY_REGISTRY } from "@/lib/engines/strategy";
import { Card } from "@/components/ui/Card";
import { HistoricalReplayForm } from "@/components/replay/HistoricalReplayForm";

export const dynamic = "force-dynamic";

export default async function HistoricalReplayPage() {
  const assets = await prisma.asset.findMany({ where: { isActive: true }, orderBy: { symbol: "asc" } });
  const strategies = STRATEGY_REGISTRY.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Historical Replay</h1>
        <p className="mt-1 text-sm text-muted">
          Reproduce cronológicamente cómo habría operado el bot usando solo la información disponible en cada instante — nunca datos futuros. El
          objetivo es determinar honestamente si hay edge real o si desaparece fuera de muestra, no fabricar una curva bonita.
        </p>
      </div>

      <Card title="DEMO / SYNTHETIC" className="border-warn/40 bg-warn/5">
        <p className="text-xs text-slate-300">
          Este proyecto no tiene ningún proveedor de datos de mercado, noticias, sentimiento u on-chain histórico REAL conectado — solo el proveedor
          DEMO (ver README). El modo <span className="font-mono">SYNTHETIC</span> genera una serie determinista y reproducible para poner a prueba
          toda esta infraestructura; <span className="font-semibold text-slate-100">nunca debe presentarse como evidencia de un edge histórico real</span>.
          El modo <span className="font-mono">HISTORICAL_REAL</span> existe en la arquitectura y se ejecuta honestamente: hoy siempre reporta{" "}
          <span className="font-mono">HISTORICAL DATA UNAVAILABLE</span> en lugar de inventar datos.
        </p>
      </Card>

      <HistoricalReplayForm assetSymbols={assets.map((a) => a.symbol)} strategies={strategies} />
    </div>
  );
}
