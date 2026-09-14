import { Card } from "@/components/ui/Card";

/**
 * Fase 15 — Replay & Execution Integrity Audit, spec section 25: "No crear
 * una nueva pantalla grande." This is a small, static transparency panel —
 * not a new screen — documenting the EXACT, audited execution conventions
 * `HistoricalReplayEngine` actually uses (verified in
 * `src/lib/replay/__tests__/executionIntegrityAudit.test.ts`), so a reader
 * doesn't have to trust a claim without a pointer to the code/tests that
 * prove it. Nothing here changes behavior — it only reports it.
 */
export function ReplayIntegrityPanel({ datasetHash }: { datasetHash?: string | null }) {
  return (
    <Card title="Replay Integrity / Audit" subtitle="Fase 15 — convenciones de ejecución auditadas (src/lib/replay/__tests__/executionIntegrityAudit.test.ts)">
      <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <div>
          <div className="font-medium text-slate-200">Dataset hash</div>
          <div className="mt-1 font-mono text-[11px] text-muted">{datasetHash ? datasetHash : "— (run no vinculado a un ResearchDataset registrado)"}</div>
        </div>
        <div>
          <div className="font-medium text-slate-200">Entrada / señal</div>
          <div className="mt-1 text-muted">Decisión y entrada ocurren en la MISMA vela: la estrategia observa el OHLC completo de la vela en tickMs (incluido su close) y, si abre, ejecuta al close de esa misma vela + slippage. `decision.entryPrice` es el precio nominal de señal; `trade.entryPrice` es el fill real (con slippage).</div>
        </div>
        <div>
          <div className="font-medium text-slate-200">Same-candle SL/TP policy</div>
          <div className="mt-1 text-muted">Determinista y pesimista: si una vela toca SL y TP a la vez, SIEMPRE se resuelve como STOP_LOSS (nunca TAKE_PROFIT). El orden intra-vela real es indeterminable desde OHLC — no se inventa un orden favorable.</div>
        </div>
        <div>
          <div className="font-medium text-slate-200">Fees</div>
          <div className="mt-1 text-muted">Fee de entrada y de salida se cobran exactamente una vez cada una. La fee de entrada se descuenta del cash al abrir; `trade.netPnl` refleja gross P&amp;L menos la fee de SALIDA únicamente (convención ya auditada en Fase 1.A2 / pnlMath.audit.test.ts) — el retorno total de la cuenta SÍ incluye ambas fees.</div>
        </div>
        <div>
          <div className="font-medium text-slate-200">Slippage</div>
          <div className="mt-1 text-muted">Aplicado una sola vez, ya incorporado en el fillPrice (spread + slippage configurado, adverso a la dirección del trade). `slippageCost` es solo informativo — nunca se resta una segunda vez.</div>
        </div>
        <div>
          <div className="font-medium text-slate-200">Sizing</div>
          <div className="mt-1 text-muted">Fixed-fractional: riesgo = equity × riskPerTradePct sobre la distancia al stop nominal. Exposición/concentración/correlación actúan como techo que REDUCE el notional (nunca lo aumenta) — approvedNotional ≤ requestedNotional siempre.</div>
        </div>
      </div>
    </Card>
  );
}
