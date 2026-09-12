"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { findSectionForPath } from "./nav";

/**
 * Tab strip shown at the top of pages that belong to one of the 7 grouped
 * sections (spec §2) — e.g. Research groups News/Sentiment/On-Chain/etc.
 * Every underlying page still lives at its own original route; this is
 * purely a navigation affordance so the sidebar can stay at 7 items without
 * deleting any functionality.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const items = findSectionForPath(pathname);
  if (!items) return null;

  return (
    <div className="-mt-1 mb-1 flex flex-wrap gap-1 border-b border-bg-border pb-2">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "rounded-full px-3 py-1 text-xs transition-colors",
              active ? "bg-accent/10 text-accent" : "text-muted hover:bg-white/5 hover:text-slate-200"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
