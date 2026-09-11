import { MonteCarloRunner } from "@/components/backtesting/MonteCarloRunner";

export default function MonteCarloPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Laboratorio Monte Carlo</h1>
        <p className="mt-1 text-sm text-muted">Caracteriza el rango de resultados posibles y el riesgo de ruina — nunca una promesa de retornos futuros.</p>
      </div>
      <MonteCarloRunner />
    </div>
  );
}
