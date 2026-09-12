"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { NAV_ITEMS } from "./nav";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-bg-border bg-bg-panel md:flex">
      <div className="flex items-center gap-2 border-b border-bg-border px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-accent/15 font-mono text-sm font-bold text-accent">λ</div>
        <div>
          <div className="text-sm font-semibold text-slate-100">AI Trading Bot Lab</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Solo Paper Trading</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "rounded px-2.5 py-2 text-sm transition-colors",
                  active ? "bg-accent/10 text-accent" : "text-slate-300 hover:bg-white/5 hover:text-slate-100"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="border-t border-bg-border px-4 py-3 text-[10px] text-muted">
        MODO DEMO — todos los datos son sintéticos, todas las operaciones son simuladas.
      </div>
    </aside>
  );
}
