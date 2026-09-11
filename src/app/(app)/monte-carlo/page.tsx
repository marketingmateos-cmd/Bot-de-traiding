import { MonteCarloRunner } from "@/components/backtesting/MonteCarloRunner";

export default function MonteCarloPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Monte Carlo Lab</h1>
        <p className="mt-1 text-sm text-muted">Characterizes the range of outcomes and risk of ruin — never a promise of future returns.</p>
      </div>
      <MonteCarloRunner />
    </div>
  );
}
