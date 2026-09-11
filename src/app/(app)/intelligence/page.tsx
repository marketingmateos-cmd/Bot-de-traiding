import { getSymbolAnalysis } from "@/lib/orchestrator";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { ScoreBar } from "@/components/ui/StatTile";
import { Badge, regimeTone } from "@/components/ui/Badge";
import Link from "next/link";
import clsx from "clsx";

export const dynamic = "force-dynamic";

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol: rawSymbol } = await searchParams;
  const symbol = (rawSymbol ?? "BTC").toUpperCase();
  const analysis = await getSymbolAnalysis(symbol, "H1");
  const mi = analysis.marketIntelligence;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Crypto Intelligence</h1>
        <p className="mt-1 text-sm text-muted">Every component behind the Market Intelligence Score, always shown — never a single opaque number.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUPPORTED_ASSETS.map((a) => (
          <Link
            key={a.symbol}
            href={`/intelligence?symbol=${a.symbol}`}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs",
              a.symbol === symbol ? "border-accent bg-accent/10 text-accent" : "border-bg-border text-muted hover:text-slate-200"
            )}
          >
            {a.symbol}
          </Link>
        ))}
      </div>

      {mi ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title={`${symbol} Market Intelligence`} className="lg:col-span-1">
            <div className="font-mono text-4xl font-bold text-accent">{mi.score}<span className="text-base text-muted">/100</span></div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={regimeTone(mi.components.regime)}>{mi.components.regime}</Badge>
              <Badge tone="muted">Data Confidence {mi.dataConfidence}%</Badge>
            </div>
          </Card>

          <Card title="Components" className="lg:col-span-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ScoreBar label="Trend" value={mi.components.trend} />
              <ScoreBar label="Momentum" value={mi.components.momentum} />
              <ScoreBar label="Volatility" value={mi.components.volatility} />
              <ScoreBar label="Volume" value={mi.components.volume} />
              <ScoreBar label="News" value={mi.components.news} />
              <ScoreBar label="Sentiment" value={mi.components.sentiment} />
              {mi.components.onChain !== null ? (
                <ScoreBar label="On-Chain" value={mi.components.onChain} />
              ) : (
                <div className="text-xs text-muted">On-Chain: DATA UNAVAILABLE</div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted">Not enough historical bars yet to compute a Market Intelligence Score for {symbol}.</p>
        </Card>
      )}

      <Card title="Raw Indicators">
        {analysis.features ? (
          <div className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
            <div>SMA20: {analysis.features.sma20?.toFixed(2) ?? "—"}</div>
            <div>SMA50: {analysis.features.sma50?.toFixed(2) ?? "—"}</div>
            <div>RSI14: {analysis.features.rsi14?.toFixed(1) ?? "—"}</div>
            <div>ATR14: {analysis.features.atr14?.toFixed(2) ?? "—"}</div>
            <div>MACD hist: {analysis.features.macdHistogram?.toFixed(3) ?? "—"}</div>
            <div>BB upper: {analysis.features.bbUpper?.toFixed(2) ?? "—"}</div>
            <div>BB lower: {analysis.features.bbLower?.toFixed(2) ?? "—"}</div>
            <div>Volume Z: {analysis.features.volumeZScore20?.toFixed(2) ?? "—"}</div>
          </div>
        ) : (
          <p className="text-sm text-muted">No indicators available yet.</p>
        )}
      </Card>
    </div>
  );
}
