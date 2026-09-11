import { getSymbolAnalysis } from "@/lib/orchestrator";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function SentimentPage() {
  const analyses = await Promise.all(SUPPORTED_ASSETS.map((a) => getSymbolAnalysis(a.symbol, "H1")));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Sentimiento</h1>
        <p className="mt-1 text-sm text-muted">Sentimiento actual, tendencia, aceleración y divergencia con el precio de cada activo.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-bg-border bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="px-3 py-2">Activo</th>
              <th className="px-3 py-2">Sentimiento</th>
              <th className="px-3 py-2">Tendencia</th>
              <th className="px-3 py-2">Aceleración</th>
              <th className="px-3 py-2">Δ Precio (20 velas)</th>
              <th className="px-3 py-2">Divergencia</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((a) => (
              <tr key={a.symbol} className="border-t border-bg-border">
                <td className="px-3 py-2 font-medium">{a.symbol}</td>
                <td className={`px-3 py-2 font-mono ${a.sentiment.current >= 0 ? "text-accent" : "text-danger"}`}>{a.sentiment.current.toFixed(2)}</td>
                <td className="px-3 py-2 font-mono">{a.sentiment.trend.toFixed(3)}</td>
                <td className="px-3 py-2 font-mono">{a.sentiment.acceleration.toFixed(3)}</td>
                <td className={`px-3 py-2 font-mono ${a.priceChangePct >= 0 ? "text-accent" : "text-danger"}`}>{a.priceChangePct.toFixed(2)}%</td>
                <td className="px-3 py-2">
                  {a.sentiment.divergence ? <Badge tone="warn">Divergencia detectada</Badge> : <Badge tone="muted">Ninguna</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card title="Cómo interpretar la Divergencia Sentimiento-Precio">
        <p className="text-xs text-muted">
          La divergencia se marca cuando el precio y el sentimiento se mueven en direcciones opuestas con un margen relevante — p. ej. precio +2,4% mientras
          el sentimiento cae un 8%. Es una señal que rebaja la confianza en el Trade Gate, nunca un bloqueo directo: reduce la confianza en vez de asumir
          quién &quot;tiene razón&quot;.
        </p>
      </Card>
    </div>
  );
}
