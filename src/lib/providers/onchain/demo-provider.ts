import type { OnChainMetricName, OnChainMetricResult, OnChainProvider } from "../types";
import { hashStringToSeed, mulberry32 } from "../market-data/seeded-random";

const ALL_METRICS: OnChainMetricName[] = [
  "exchange_inflow",
  "exchange_outflow",
  "whale_activity",
  "active_addresses",
  "transaction_volume",
  "supply_on_exchanges",
  "stablecoin_flows",
];

// Demo mode is explicit about the real-world limitation from spec §13:
// not every metric is available for every asset/provider. Some
// combinations are deliberately marked unavailable rather than fabricated,
// so the "DATA UNAVAILABLE" UI path is real, not decorative.
const UNAVAILABLE_FOR: Partial<Record<string, OnChainMetricName[]>> = {
  DOGE: ["stablecoin_flows"],
  ADA: ["stablecoin_flows", "whale_activity"],
  XRP: ["stablecoin_flows"],
};

export class DemoOnChainProvider implements OnChainProvider {
  readonly id = "demo";
  readonly isDemo = true;

  getSupportedMetrics(): OnChainMetricName[] {
    return ALL_METRICS;
  }

  async getMetric(symbol: string, metric: OnChainMetricName): Promise<OnChainMetricResult> {
    const unavailable = UNAVAILABLE_FOR[symbol.toUpperCase()]?.includes(metric);
    const timestamp = new Date();
    if (unavailable) {
      return { symbol, metric, timestamp, value: null, available: false };
    }

    const hourSeed = Math.floor(Date.now() / (1000 * 60 * 60));
    const rand = mulberry32(hashStringToSeed(`onchain:${symbol}:${metric}:${hourSeed}`));

    let value: number;
    switch (metric) {
      case "exchange_inflow":
      case "exchange_outflow":
        value = 500 + rand() * 5000;
        break;
      case "whale_activity":
        value = rand() * 100; // index 0-100
        break;
      case "active_addresses":
        value = 10000 + rand() * 500000;
        break;
      case "transaction_volume":
        value = 1_000_000 + rand() * 500_000_000;
        break;
      case "supply_on_exchanges":
        value = 5 + rand() * 20; // % of supply
        break;
      case "stablecoin_flows":
        value = (rand() - 0.4) * 200_000_000;
        break;
      default:
        value = rand() * 100;
    }

    return { symbol, metric, timestamp, value, available: true };
  }
}
