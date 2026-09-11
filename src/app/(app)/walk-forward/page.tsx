import { WalkForwardRunner } from "@/components/backtesting/WalkForwardRunner";

export default function WalkForwardPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Walk-Forward Testing</h1>
        <p className="mt-1 text-sm text-muted">The single best defense against overfitting: does the edge survive on data the strategy never trained on?</p>
      </div>
      <WalkForwardRunner />
    </div>
  );
}
