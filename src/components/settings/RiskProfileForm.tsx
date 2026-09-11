"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROFILES = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"];

export function RiskProfileForm({ accountId, current }: { accountId: string; current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  async function save(next: string) {
    setValue(next);
    setSaving(true);
    try {
      await fetch("/api/settings/risk-profile", { method: "POST", body: JSON.stringify({ accountId, riskProfile: next }) });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {PROFILES.map((p) => (
        <button
          key={p}
          onClick={() => save(p)}
          disabled={saving}
          className={`rounded-full border px-3 py-1.5 text-xs ${
            value === p ? "border-accent bg-accent/10 text-accent" : "border-bg-border text-muted hover:text-slate-200"
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
