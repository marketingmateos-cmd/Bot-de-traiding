import { prisma } from "@/lib/db";
import { BASELINE_STRATEGY_REGISTRY } from "@/lib/engines/strategy";
import { StrategyLabForm } from "@/components/strategyLab/StrategyLabForm";

export const dynamic = "force-dynamic";

export default async function StrategyLabPage() {
  const assets = await prisma.asset.findMany({ where: { isActive: true }, orderBy: { symbol: "asc" } });
  const strategies = BASELINE_STRATEGY_REGISTRY.map((s) => ({ id: s.id, name: s.name, version: s.version, defaultParams: s.defaultParams }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Strategy Lab</h1>
        <p className="mt-1 text-sm text-muted">
          Benchmark cuantitativo de familias de estrategias (Breakout, Momentum, Mean Reversion, Trend Following) bajo condiciones IDÉNTICAS de
          dataset, Risk Engine y Evaluation Profile. El objetivo es descubrir qué familias muestran señales prometedoras — no encontrar los mejores
          parámetros ni declarar un ganador definitivo.
        </p>
      </div>

      <StrategyLabForm assetSymbols={assets.map((a) => a.symbol)} strategies={strategies} />
    </div>
  );
}
