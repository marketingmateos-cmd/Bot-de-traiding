import type { Mt5AccountInfo, PlaceOrderResult } from "../types";
import type { Mt5ClientLike } from "../mt5Client";

export const DEMO_ACCOUNT: Mt5AccountInfo = {
  broker: "Test Broker Ltd",
  server: "TestBroker-Demo",
  loginId: "1234567",
  accountType: "DEMO",
  balance: 20000,
  equity: 20000,
  margin: 0,
  freeMargin: 20000,
  leverage: 100,
  currency: "EUR",
};

export const LIVE_ACCOUNT: Mt5AccountInfo = { ...DEMO_ACCOUNT, accountType: "LIVE" };

export const UNKNOWN_TYPE_ACCOUNT: Mt5AccountInfo = { ...DEMO_ACCOUNT, accountType: null };

export function makeFakeMt5Client(overrides: Partial<Mt5ClientLike> = {}): Mt5ClientLike {
  return {
    login: async () => ({ ok: true, error: null }),
    logout: async () => {},
    isConnected: async () => true,
    accountInfo: async () => DEMO_ACCOUNT,
    symbols: async () => ["EURUSD"],
    symbolInfo: async () => null,
    quote: async () => null,
    positions: async () => [],
    historicalRates: async () => [],
    orderSend: async (): Promise<PlaceOrderResult> => ({ status: "FILLED", ticket: "999", filledPrice: 1.1, executionLatencyMs: 5, rejectionReason: null }),
    ...overrides,
  };
}
