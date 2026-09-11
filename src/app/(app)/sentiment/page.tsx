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
        <h1 className="text-lg font-semibold text-slate-100">Sentiment</h1>
        <p className="mt-1 text-sm text-muted">Current sentiment, trend, acceleration, and divergence against price for every asset.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-bg-border bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="px-3 py-2">Asset</th>
              <th className="px-3 py-2">Sentiment</th>
              <th className="px-3 py-2">Trend</th>
              <th className="px-3 py-2">Acceleration</th>
              <th className="px-3 py-2">Price Δ (20 bars)</th>
              <th className="px-3 py-2">Divergence</th>
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
                  {a.sentiment.divergence ? <Badge tone="warn">Divergence detected</Badge> : <Badge tone="muted">None</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card title="How to read Sentiment-Price Divergence">
        <p className="text-xs text-muted">
          Divergence flags when price and sentiment move in opposite directions by a meaningful margin — e.g. price +2.4% while sentiment falls 8%. It is a
          downgrade signal in the Trade Gate, never an outright block: it lowers confidence rather than assuming which side is &quot;right&quot;.
        </p>
      </Card>
    </div>
  );
}
