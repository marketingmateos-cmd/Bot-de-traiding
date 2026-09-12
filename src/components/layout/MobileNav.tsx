"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Menu, X, LayoutDashboard, LineChart, Wallet, FlaskConical } from "lucide-react";
import { NAV_ITEMS } from "./nav";

const QUICK_ITEMS = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/markets", label: "Mercados", icon: LineChart },
  { href: "/paper-trading", label: "Operar", icon: FlaskConical },
  { href: "/portfolio", label: "Cartera", icon: Wallet },
];

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="flex items-center justify-between border-b border-bg-border bg-bg-panel px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 font-mono text-xs font-bold text-accent">λ</div>
          <span className="text-sm font-semibold text-slate-100">AI Trading Bot Lab</span>
        </div>
        <button onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded p-1.5 text-slate-300 hover:bg-white/5">
          <Menu size={20} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg/98 backdrop-blur md:hidden">
          <div className="flex items-center justify-between border-b border-bg-border px-4 py-4">
            <span className="text-sm font-semibold text-slate-100">Menú</span>
            <button onClick={() => setOpen(false)} aria-label="Cerrar menú" className="rounded p-1.5 text-slate-300 hover:bg-white/5">
              <X size={20} />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-base text-slate-200 hover:bg-white/5"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-bg-border bg-bg-panel md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {QUICK_ITEMS.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]", active ? "text-accent" : "text-muted")}
          >
            <Icon size={18} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
