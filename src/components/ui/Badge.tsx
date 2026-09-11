import clsx from "clsx";
import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "danger" | "warn" | "info" | "muted";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-slate-800 text-slate-200 border-slate-700",
  success: "bg-accent/10 text-accent border-accent/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  info: "bg-info/10 text-info border-info/30",
  muted: "bg-white/5 text-muted border-white/10",
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

export function verdictTone(verdict: string): BadgeTone {
  switch (verdict) {
    case "APPROVED":
    case "ROBUST":
    case "GOOD_EXECUTION":
      return "success";
    case "LOW_CONFIDENCE":
    case "PROMISING":
    case "MEDIUM":
      return "warn";
    case "BLOCKED":
    case "INSUFFICIENT_EVIDENCE":
    case "BAD_EXECUTION":
    case "LOW":
    case "HIGH_RISK":
      return "danger";
    default:
      return "neutral";
  }
}

export function regimeTone(regime: string): BadgeTone {
  if (regime.includes("BULL")) return "success";
  if (regime.includes("BEAR")) return "danger";
  if (regime === "HIGH_VOLATILITY") return "warn";
  return "info";
}
