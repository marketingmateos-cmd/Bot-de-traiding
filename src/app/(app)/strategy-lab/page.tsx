import { prisma } from "@/lib/db";
import { BASELINE_STRATEGY_REGISTRY, RESEARCH_STRATEGY_REGISTRY, getHypothesis, FTMO_CANDIDATE_STRATEGY_REGISTRY, getFtmoHypothesis } from "@/lib/engines/strategy";
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
  // Multi-Estrategias Candidatas FTMO — mismo patrón que las research (Fase
  // 17): marcadas EXPERIMENTAL con family/hypothesis, nunca un tercer modo de
  // ejecución. Candidatas de preselección estilo FTMO, no ganadoras.
  const ftmoStrategies = FTMO_CANDIDATE_STRATEGY_REGISTRY.map((s) => {
    const h = getFtmoHypothesis(s.id);
    return { id: s.id, name: s.name, version: s.version, defaultParams: s.defaultParams, experimental: true, family: h?.family, hypothesis: h?.hypothesis };
  });
  const strategies = [...baselineStrategies, ...researchStrategies, ...ftmoStrategies];

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
        <p className="mt-1 text-sm text-muted">
          Las <span className="font-semibold text-warn">Candidatas FTMO</span> (Tendencia/Breakout, Reversión a la Media, Cruce de Medias con
          Momentum v1/v2/v2.1, Apex Breakout v1/v2, Sniper High Conviction) buscan rentabilidad moderada y constante (2-5% mensual objetivo) con
          riesgo bajo por operación — son candidatas de preselección para backtesting y filtrado, no estrategias en producción. v2 añade un
          filtro de volatilidad mínima y un Take Profit dinámico sobre v1; v2.1 relaja ese filtro (0.75x en vez de 1.0x). Apex Breakout (Candidata
          D) es una familia distinta: ruptura de volatilidad tras compresión, con un objetivo de R:R deliberadamente asimétrico (1:3.5); su v2
          añade un circuit breaker que reduce el tamaño de posición a la mitad tras 3 pérdidas consecutivas propias. Sniper High Conviction
          (Candidata E) lleva la selectividad al extremo — compresión máxima, gatillo de energía 2.0×ATR y un pico de volumen real simultáneos —
          y, a cambio de operar muy poco, arriesga el doble de tamaño por operación.
        </p>
      </div>

      <StrategyLabForm assetSymbols={assets.map((a) => a.symbol)} strategies={strategies} />
    </div>
  );
}
