import { WalkForwardRunner } from "@/components/backtesting/WalkForwardRunner";

export default function WalkForwardPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Walk-Forward Testing</h1>
        <p className="mt-1 text-sm text-muted">La mejor defensa contra el sobreajuste: ¿sobrevive la ventaja en datos con los que la estrategia nunca entrenó?</p>
      </div>
      <WalkForwardRunner />
    </div>
  );
}
