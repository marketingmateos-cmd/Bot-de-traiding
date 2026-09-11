import { BacktestRunner } from "@/components/backtesting/BacktestRunner";

export default function BacktestingPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Backtesting</h1>
        <p className="mt-1 text-sm text-muted">Incluye simulación de comisiones, spread, slippage y stop/objetivo — nunca un backtest de fantasía sin fricción.</p>
      </div>
      <BacktestRunner />
    </div>
  );
}
