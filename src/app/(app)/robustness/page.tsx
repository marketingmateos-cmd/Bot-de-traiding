import { RobustnessRunner } from "@/components/backtesting/RobustnessRunner";

export default function RobustnessPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Laboratorio de Robustez</h1>
        <p className="mt-1 text-sm text-muted">Una estrategia solo consigue una puntuación alta si sobrevive a varias pruebas de estrés independientes — ninguna ejecución buena por sí sola basta.</p>
      </div>
      <RobustnessRunner />
    </div>
  );
}
