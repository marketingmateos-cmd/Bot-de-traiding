import { Badge } from "./ui/Badge";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface GateStep {
  name: string;
  passed: boolean;
  downgrade: boolean;
  detail: string;
}

export function GateStepList({ steps, verdict, blockedBy }: { steps: GateStep[]; verdict: string; blockedBy: string | null }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={verdict === "APPROVED" ? "success" : verdict === "LOW_CONFIDENCE" ? "warn" : "danger"}>{verdict}</Badge>
        {blockedBy && <span className="text-xs text-muted">at {blockedBy}</span>}
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((step) => (
          <li key={step.name} className="flex items-start gap-2 rounded border border-bg-border bg-black/20 px-2.5 py-2 text-xs">
            {!step.passed ? (
              <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
            ) : step.downgrade ? (
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
            ) : (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" />
            )}
            <div>
              <div className="font-medium text-slate-200">{step.name.replace(/_/g, " ")}</div>
              <div className="mt-0.5 text-muted">{step.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
