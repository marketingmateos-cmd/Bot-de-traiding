"use client";

import { useMemo, useState } from "react";
import { EquityCurveChart } from "@/components/charts/EquityCurveChart";

const RANGES = [
  { key: "7D", days: 7 },
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
  { key: "180D", days: 180 },
  { key: "1Y", days: 365 },
  { key: "ALL", days: null },
] as const;

export function EquityRangeChart({ series }: { series: { t: number; equity: number }[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("ALL");

  const filtered = useMemo(() => {
    const config = RANGES.find((r) => r.key === range)!;
    if (config.days === null || series.length === 0) return series;
    const cutoff = Date.now() - config.days * 86_400_000;
    const sliced = series.filter((p) => p.t >= cutoff);
    // always keep one point before the cutoff so the line doesn't start at zero
    if (sliced.length === series.length) return series;
    const firstIncludedIndex = series.length - sliced.length;
    return firstIncludedIndex > 0 ? series.slice(firstIncludedIndex - 1) : sliced;
  }, [series, range]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              range === r.key ? "border-accent/40 bg-accent/10 text-accent" : "border-bg-border text-muted hover:text-slate-200"
            }`}
          >
            {r.key}
          </button>
        ))}
      </div>
      <EquityCurveChart data={filtered} />
    </div>
  );
}
