import clsx from "clsx";
import type { ReactNode } from "react";

export function StatTile({
  label,
  value,
  sublabel,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: "neutral" | "positive" | "negative";
  className?: string;
}) {
  return (
    <div className={clsx("rounded-lg border border-bg-border bg-bg-card p-3", className)}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={clsx(
          "mt-1 font-mono text-xl font-semibold tabular-nums",
          tone === "positive" && "text-accent",
          tone === "negative" && "text-danger",
          tone === "neutral" && "text-slate-100"
        )}
      >
        {value}
      </div>
      {sublabel && <div className="mt-0.5 text-[11px] text-muted">{sublabel}</div>}
    </div>
  );
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 66 ? "bg-accent" : value >= 40 ? "bg-warn" : "bg-danger";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-slate-300">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div className={clsx("h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
