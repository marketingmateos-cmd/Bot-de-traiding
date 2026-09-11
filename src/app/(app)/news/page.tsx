import { getNewsProvider } from "@/lib/providers/registry";
import { scoreNews } from "@/lib/engines/news";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { tNewsCategory } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const provider = getNewsProvider();
  const items = await provider.getRecentNews(SUPPORTED_ASSETS.map((a) => a.symbol), 60);
  const scored = scoreNews(items).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const clusters = new Set(scored.map((s) => s.clusterKey ?? s.title));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Noticias</h1>
        <p className="mt-1 text-sm text-muted">
          {items.length} artículos en {clusters.size} noticias distintas — la cobertura repetida de una misma noticia se deduplica mediante el Novelty
          Score, sin contarse como eventos independientes. {provider.isDemo && <Badge tone="muted" className="ml-1">DATOS DEMO</Badge>}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {scored.map((item, i) => (
          <Card key={i} className="!p-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <Badge tone="muted">{tNewsCategory(item.category)}</Badge>
              <span>{item.source}</span>
              <span>{item.publishedAt.toLocaleString()}</span>
            </div>
            <div className="mt-1 text-sm font-medium text-slate-100">{item.title}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
              <span>
                Impacto: <span className="font-mono text-slate-200">{item.impactScore}</span>
              </span>
              <span>
                Novedad: <span className="font-mono text-slate-200">{item.noveltyScore}</span>
              </span>
              <span>
                Sentimiento:{" "}
                <span className={`font-mono ${item.sentiment >= 0 ? "text-accent" : "text-danger"}`}>{item.sentiment.toFixed(2)}</span>
              </span>
              <span>Activos: {item.assets.join(", ")}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
