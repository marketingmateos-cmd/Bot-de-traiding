import { prisma } from "@/lib/db";
import { BASELINE_STRATEGY_REGISTRY, RESEARCH_STRATEGY_REGISTRY, getHypothesis } from "@/lib/engines/strategy";
import { StrategyLabForm } from "@/components/strategyLab/StrategyLabForm";

export const dynamic = "force-dynamic";

export default async function StrategyLabPage() {
  const assets = await prisma.asset.findMany({ where: { isActive: true }, orderBy: { symbol: "asc" } });
  const baselineStrategies = BASELINE_STRATEGY_REGISTRY.map((s) => ({ id: s.id, name: s.name, version: s.version, defaultParams: s.defaultParams, experimental: false }));
  // Fase 17 — Signal Research Lab: same benchmark, same Risk Engine, same
  // Evaluation profile as the Fase 11 baselines (spec section 9/10), the
  // ONLY difference surfaced here is the "EXPERIMENTAL" label + family/
  // hypothesis metadata (spec section 21) — never a different execution path.
  const researchStrategies = RESEARCH_STRATEGY_REGISTRY.map((s) => {
    const h = getHypothesis(s.id);
    return { id: s.id, name: s.name, version: s.version, defaultParams: s.defaultParams, experimental: true, family: h?.family, hypothesis: h?.hypothesis };
  });
  const strategies = [...baselineStrategies, ...researchStrategies];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Strategy Lab</h1>
        <p className="mt-1 text-sm text-muted">
          Benchmark cuantitativo de familias de estrategias (Breakout, Momentum, Mean Reversion, Trend Following) bajo condiciones IDÉNTICAS de
          dataset, Risk Engine y Evaluation Profile. El objetivo es descubrir qué familias muestran señales prometedoras — no encontrar los mejores
          parámetros ni declarar un ganador definitivo.
        </p>
        <p className="mt-1 text-sm text-muted">
          Las estrategias marcadas <span className="font-semibold text-warn">EXPERIMENTAL</span> (Fase 17) son hipótesis de investigación nuevas,
          con parámetros fijados antes de ver resultados — ninguna ha sido optimizada ni declarada ganadora.
        </p>
      </div>

      <StrategyLabForm assetSymbols={assets.map((a) => a.symbol)} strategies={strategies} />
    </div>
  );
}
