"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-fetches the server-rendered page (spec §5: P&L/positions
 * must update without a manual action). Cheap and honest: it just re-runs
 * the same Prisma queries the page already renders with, no websocket
 * infrastructure — good enough at a several-second cadence for a paper
 * trading lab.
 */
export function LiveRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
