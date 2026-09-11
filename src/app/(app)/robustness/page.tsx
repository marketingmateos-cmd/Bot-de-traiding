import { RobustnessRunner } from "@/components/backtesting/RobustnessRunner";

export default function RobustnessPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Robustness Lab</h1>
        <p className="mt-1 text-sm text-muted">A strategy only earns a high score by surviving several independent stress tests — no single good run can do it alone.</p>
      </div>
      <RobustnessRunner />
    </div>
  );
}
