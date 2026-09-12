"use client";

export interface ExportRow {
  date: string;
  time: string;
  asset: string;
  direction: string;
  strategy: string;
  entry: number;
  exit: number;
  pnl: number;
  pnlPct: number;
  riskLevel: number;
  result: string;
  durationMinutes: number;
  fees: number;
  slippage: number;
}

function toCsv(rows: ExportRow[]): string {
  const headers = ["Date", "Time", "Asset", "Direction", "Strategy", "Entry", "Exit", "P&L", "P&L %", "Risk", "Result", "Duration (min)", "Fees", "Slippage"];
  const lines = rows.map((r) =>
    [r.date, r.time, r.asset, r.direction, r.strategy, r.entry, r.exit, r.pnl.toFixed(2), r.pnlPct.toFixed(2), r.riskLevel, r.result, r.durationMinutes, r.fees.toFixed(4), r.slippage.toFixed(4)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [headers.join(","), ...lines].join("\n");
}

export function JournalExportButton({ rows, filenamePrefix = "journal" }: { rows: ExportRow[]; filenamePrefix?: string }) {
  function exportCsv() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex gap-2">
      <button onClick={exportCsv} className="rounded border border-bg-border px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
        Exportar CSV
      </button>
      <button onClick={exportJson} className="rounded border border-bg-border px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
        Exportar JSON
      </button>
    </div>
  );
}
