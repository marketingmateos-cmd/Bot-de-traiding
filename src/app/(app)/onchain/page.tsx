import { getOnChainProvider } from "@/lib/providers/registry";
import { SUPPORTED_ASSETS } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { OnChainMetricName } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const METRIC_LABELS: Record<OnChainMetricName, string> = {
  exchange_inflow: "Exchange Inflow",
  exchange_outflow: "Exchange Outflow",
  whale_activity: "Whale Activity Index",
  active_addresses: "Active Addresses",
  transaction_volume: "Transaction Volume",
  supply_on_exchanges: "Supply on Exchanges (%)",
  stablecoin_flows: "Stablecoin Flows",
};

export default async function OnChainPage() {
  const provider = getOnChainProvider();
  const metrics = provider.getSupportedMetrics();

  const rows = await Promise.all(
    SUPPORTED_ASSETS.map(async (asset) => {
      const values = await Promise.all(metrics.map((m) => provider.getMetric(asset.symbol, m)));
      return { symbol: asset.symbol, values };
    })
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">On-Chain</h1>
        <p className="mt-1 text-sm text-muted">
          {provider.isDemo && <Badge tone="muted" className="mr-1">DEMO DATA</Badge>}
          Metrics genuinely marked DATA UNAVAILABLE where a provider does not supply them — never fabricated.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-bg-border bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="px-3 py-2">Asset</th>
              {metrics.map((m) => (
                <th key={m} className="px-3 py-2">{METRIC_LABELS[m]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol} className="border-t border-bg-border">
                <td className="px-3 py-2 font-medium">{row.symbol}</td>
                {row.values.map((v, idx) => (
                  <td key={idx} className="px-3 py-2 font-mono">
                    {v.available ? (
                      v.value !== null ? v.value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"
                    ) : (
                      <Badge tone="muted">DATA UNAVAILABLE</Badge>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
