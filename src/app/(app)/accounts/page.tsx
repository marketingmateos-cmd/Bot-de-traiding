import { Mt5AccountCard } from "@/components/accounts/Mt5AccountCard";
import { EvaluationAccountCard } from "@/components/accounts/EvaluationAccountCard";

export const dynamic = "force-dynamic";

export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Accounts</h1>
        <p className="mt-1 text-sm text-muted">
          Conecta una cuenta DEMO de MetaTrader 5 para research/paper trading sobre mercado real, sin dinero real. Ninguna cuenta LIVE es aceptada.
        </p>
      </div>
      <Mt5AccountCard />
      <EvaluationAccountCard />
    </div>
  );
}
