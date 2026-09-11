import { getSymbolAnalysis } from "@/lib/orchestrator";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { Badge, regimeTone } from "@/components/ui/Badge";
import { Sparkline } from "@/components/charts/Sparkline";
import { tRegime } from "@/lib/i18n";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const analyses = await Promise.all(SUPPORTED_ASSETS.map((a) => getSymbolAnalysis(a.symbol, "H1")));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Mercados</h1>
        <p className="mt-1 text-sm text-muted">Datos OHLCV (demo), indicadores, régimen y calidad de datos de cada activo monitorizado.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {analyses.map((a) => {
          const closes = a.bars.slice(-60).map((b) => b.close);
          const positive = a.priceChangePct >= 0;
          return (
            <Card key={a.symbol} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-semibold text-slate-100">{a.symbol}</div>
                  <div className="font-mono text-lg tabular-nums">{a.latestPrice?.toFixed(a.latestPrice && a.latestPrice < 5 ? 4 : 2)}</div>
                </div>
                <div className={`font-mono text-sm ${positive ? "text-accent" : "text-danger"}`}>
                  {positive ? "+" : ""}
                  {a.priceChangePct.toFixed(2)}%
                </div>
              </div>
              <Sparkline data={closes} positive={positive} />
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={regimeTone(a.regime.regime)}>{tRegime(a.regime.regime)}</Badge>
                <Badge tone={a.dataQuality.score >= 70 ? "success" : a.dataQuality.score >= 55 ? "warn" : "danger"}>
                  Calidad {a.dataQuality.score}
                </Badge>
                {a.marketIntelligence && <Badge tone="info">IM {a.marketIntelligence.score}</Badge>}
              </div>
              {a.dataQuality.blocksTrading && (
                <div className="rounded border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">BLOQUEADO — CALIDAD DE DATOS</div>
              )}
              <Link href={`/intelligence?symbol=${a.symbol}`} className="text-xs text-accent underline">
                Ver desglose completo →
              </Link>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
