import { BacktestRunner } from "@/components/backtesting/BacktestRunner";

export default function BacktestingPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Backtesting</h1>
        <p className="mt-1 text-sm text-muted">Fees, spread, slippage, and stop/target simulation included — never a frictionless fantasy backtest.</p>
      </div>
      <BacktestRunner />
    </div>
  );
}
