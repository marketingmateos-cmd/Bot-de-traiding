"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { tDirection, tExitReason } from "@/lib/i18n";

export interface CalendarDayTrade {
  id: string;
  time: string; // HH:MM
  assetSymbol: string;
  direction: string;
  strategyName: string;
  entryPrice: number;
  exitPrice: number;
  netPnl: number;
  pnlPct: number;
  durationMinutes: number;
  exitReason: string;
}

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  pnl: number;
  trades: number;
}

const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

function ymKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function JournalCalendar({ days, tradesByDay }: { days: CalendarDay[]; tradesByDay: Record<string, CalendarDayTrade[]> }) {
  const dayMap = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const initial = days.length > 0 ? new Date(days[days.length - 1].date + "T00:00:00Z") : new Date();
  const [year, setYear] = useState(initial.getUTCFullYear());
  const [month, setMonth] = useState(initial.getUTCMonth()); // 0-11
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startWeekday = (firstOfMonth.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: (string | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${ymKey(year, month)}-${String(i + 1).padStart(2, "0")}`),
  ];

  function goToMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
    setSelectedDate(null);
  }

  const selectedTrades = selectedDate ? tradesByDay[selectedDate] ?? [] : [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => goToMonth(-1)} className="rounded px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-slate-200">
          ← {MONTH_LABELS[(month + 11) % 12]}
        </button>
        <span className="text-sm font-medium text-slate-100">
          {MONTH_LABELS[month]} {year}
        </span>
        <button onClick={() => goToMonth(1)} className="rounded px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-slate-200">
          {MONTH_LABELS[(month + 1) % 12]} →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />;
          const stat = dayMap.get(date);
          const dayNum = Number(date.slice(-2));
          const isSelected = selectedDate === date;
          const hasTrades = stat && stat.trades > 0;
          return (
            <button
              key={date}
              onClick={() => hasTrades && setSelectedDate(isSelected ? null : date)}
              disabled={!hasTrades}
              className={clsx(
                "flex aspect-square flex-col items-center justify-center rounded border text-[10px] transition-colors",
                !hasTrades && "border-bg-border text-muted/50",
                hasTrades && stat!.pnl > 0 && "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20",
                hasTrades && stat!.pnl < 0 && "border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
                hasTrades && stat!.pnl === 0 && "border-bg-border text-slate-300",
                isSelected && "ring-1 ring-accent"
              )}
            >
              <span>{dayNum}</span>
              {hasTrades && (
                <span className="font-mono">
                  {stat!.pnl >= 0 ? "+" : ""}
                  {stat!.pnl.toFixed(1)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="mt-3 rounded border border-bg-border bg-black/20 p-3">
          <div className="mb-2 text-xs font-medium text-slate-200">Operaciones del {selectedDate}</div>
          {selectedTrades.length === 0 ? (
            <p className="text-xs text-muted">Sin operaciones.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {selectedTrades.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-muted">{t.time}</span>
                    <span className="font-medium">{t.assetSymbol}</span>
                    <Badge tone={t.direction === "LONG" ? "success" : "danger"}>{tDirection(t.direction)}</Badge>
                    <span className="text-muted">{t.strategyName}</span>
                    <span className="text-muted">· {tExitReason(t.exitReason)}</span>
                  </div>
                  <span className={`font-mono ${t.netPnl >= 0 ? "text-accent" : "text-danger"}`}>
                    {t.netPnl >= 0 ? "+" : ""}€{t.netPnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
