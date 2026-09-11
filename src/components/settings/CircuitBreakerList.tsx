"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";

interface Breaker {
  id: string;
  name: string;
  kind: string;
  isTripped: boolean;
  trippedReason: string | null;
}

export function CircuitBreakerList({ breakers, accountId }: { breakers: Breaker[]; accountId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function reset(name: string) {
    setPending(name);
    try {
      await fetch("/api/circuit-breakers/reset", { method: "POST", body: JSON.stringify({ name, accountId }) });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {breakers.map((b) => (
        <div key={b.id} className="flex items-center justify-between rounded border border-bg-border bg-black/20 px-3 py-2 text-xs">
          <div>
            <span className="font-mono font-medium">{b.name}</span>
            {b.isTripped && <span className="ml-2 text-muted">{b.trippedReason}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={b.isTripped ? "danger" : "success"}>{b.isTripped ? "TRIPPED" : "OK"}</Badge>
            {b.isTripped && (
              <button
                onClick={() => reset(b.name)}
                disabled={pending === b.name}
                className="rounded border border-bg-border px-2 py-1 text-[11px] hover:bg-white/5 disabled:opacity-50"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
