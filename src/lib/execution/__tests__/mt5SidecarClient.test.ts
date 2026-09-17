import { describe, expect, it, vi } from "vitest";
import { createMt5SidecarClient, type FetchLike } from "../mt5SidecarClient";

const BASE_URL = "http://127.0.0.1:47822";
const TOKEN = "test-shared-secret";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeFakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchLike {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as unknown as FetchLike;
}

describe("createMt5SidecarClient — login()", () => {
  it("sends credentials as a POST body with the auth header, never in the URL", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = makeFakeFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { ok: true, error: null });
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });

    const result = await client.login({ login: "12345", password: "hunter2", server: "Demo-Server" });

    expect(result).toEqual({ ok: true, error: null });
    expect(capturedUrl).toBe(`${BASE_URL}/mt5/login`);
    expect(capturedUrl).not.toContain("hunter2");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["X-MT5-Sidecar-Token"]).toBe(TOKEN);
    expect(JSON.parse(capturedInit?.body as string)).toEqual({ login: "12345", password: "hunter2", server: "Demo-Server" });
  });

  it("returns ok:false with the sidecar's error message on rejected credentials", async () => {
    const fetchImpl = makeFakeFetch(() => jsonResponse(200, { ok: false, error: "MT5 login() failed: [10004] Invalid account" }));
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });

    const result = await client.login({ login: "1", password: "x", server: "Demo" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid account");
  });

  it("redacts the password from the error message even if it somehow appeared there (defense in depth)", async () => {
    const fetchImpl = makeFakeFetch(() => jsonResponse(200, { ok: false, error: "login failed for password hunter2-secret" }));
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });

    const result = await client.login({ login: "1", password: "hunter2-secret", server: "Demo" });
    expect(result.error).not.toContain("hunter2-secret");
    expect(result.error).toContain("[REDACTED]");
  });

  it("network failure returns ok:false with a safe transport error, never throws", async () => {
    const fetchImpl = makeFakeFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });

    const result = await client.login({ login: "1", password: "x", server: "Demo" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});

describe("createMt5SidecarClient — read methods never throw and degrade to safe defaults on failure", () => {
  it("isConnected() returns false when the sidecar is unreachable", async () => {
    const fetchImpl = makeFakeFetch(() => {
      throw new Error("connect failed");
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.isConnected()).toBe(false);
  });

  it("isConnected() reflects the sidecar's real status field", async () => {
    const fetchImpl = makeFakeFetch(() => jsonResponse(200, { connected: true }));
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.isConnected()).toBe(true);
  });

  it("accountInfo() maps the sidecar's JSON shape through unchanged", async () => {
    const account = { broker: "MEX Atlantic", server: "MEXAtlantic-Demo", loginId: "••••56", accountType: "DEMO" as const, balance: 10000, equity: 10050, margin: 0, freeMargin: 10050, leverage: 100, currency: "USD" };
    const fetchImpl = makeFakeFetch(() => jsonResponse(200, { account }));
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.accountInfo()).toEqual(account);
  });

  it("accountInfo() returns null on transport failure, never throws", async () => {
    const fetchImpl = makeFakeFetch(() => {
      throw new Error("timeout");
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.accountInfo()).toBeNull();
  });

  it("symbols() returns the sidecar's array, or [] on failure", async () => {
    const fetchImpl = makeFakeFetch(() => jsonResponse(200, { symbols: ["EURUSD", "USDJPY", "XAUUSD"] }));
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.symbols()).toEqual(["EURUSD", "USDJPY", "XAUUSD"]);
  });

  it("symbolInfo() encodes the symbol into the query string and maps the spec", async () => {
    let capturedUrl = "";
    const spec = { symbol: "EURUSD", tickSize: 0.00001, tickValue: 1, contractSize: 100000, volumeStep: 0.01, volumeMin: 0.01, volumeMax: 100, digits: 5 };
    const fetchImpl = makeFakeFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, { spec });
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    const result = await client.symbolInfo("EUR USD"); // deliberately contains a space to prove encoding happens
    expect(capturedUrl).toBe(`${BASE_URL}/mt5/symbol?symbol=EUR%20USD`);
    expect(result).toEqual(spec);
  });

  it("quote() converts the ISO timestamp string to a Date", async () => {
    const fetchImpl = makeFakeFetch(() => jsonResponse(200, { quote: { symbol: "EURUSD", bid: 1.1, ask: 1.1002, spread: 0.0002, last: null, timestamp: "2026-09-15T12:00:00.000Z" } }));
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    const quote = await client.quote("EURUSD");
    expect(quote?.timestamp).toBeInstanceOf(Date);
    expect(quote?.timestamp.toISOString()).toBe("2026-09-15T12:00:00.000Z");
    expect(quote?.bid).toBe(1.1);
  });

  it("quote() returns null when the sidecar reports no tick, never fabricates one", async () => {
    const fetchImpl = makeFakeFetch(() => jsonResponse(200, { quote: null }));
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.quote("EURUSD")).toBeNull();
  });

  it("historicalRates() converts every bar's timestamp to a Date and passes the requested range/timeframe in the query", async () => {
    let capturedUrl = "";
    const fetchImpl = makeFakeFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, { bars: [{ timestamp: "2026-01-01T00:00:00.000Z", open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 100, tickVolume: 100, spread: 2, realVolume: 0 }] });
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-02T00:00:00.000Z");
    const bars = await client.historicalRates("EURUSD", "H1", start, end);

    expect(capturedUrl).toContain("symbol=EURUSD");
    expect(capturedUrl).toContain("timeframe=H1");
    expect(capturedUrl).toContain(encodeURIComponent(start.toISOString()));
    expect(bars).toHaveLength(1);
    expect(bars[0].timestamp).toBeInstanceOf(Date);
  });

  it("historicalRates() returns [] on transport failure, never throws", async () => {
    const fetchImpl = makeFakeFetch(() => {
      throw new Error("boom");
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.historicalRates("EURUSD", "H1", new Date(), new Date())).toEqual([]);
  });

  it("positions() always returns [] — open-position reading is out of scope for this read-only bridge's first cut, never fabricated", async () => {
    const fetchImpl = makeFakeFetch(() => {
      throw new Error("should never be called");
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    expect(await client.positions()).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createMt5SidecarClient — orderSend() NEVER issues an HTTP request", () => {
  it("always returns a REJECTED-shaped ERROR result without calling fetch at all", async () => {
    const fetchImpl = makeFakeFetch(() => {
      throw new Error("orderSend must never reach the network");
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });

    const result = await client.orderSend({ symbol: "EURUSD", side: "BUY", volume: 0.01, stopLoss: 1.0, takeProfit: 1.2, idempotencyKey: "k1" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("ERROR");
    expect(result.ticket).toBeNull();
    expect(result.rejectionReason).toMatch(/solo lectura/i);
  });
});

describe("createMt5SidecarClient — every request carries the auth token, never the credential in a header by mistake", () => {
  it("GET requests also carry X-MT5-Sidecar-Token", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = makeFakeFetch((_url, init) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return jsonResponse(200, { connected: false });
    });
    const client = createMt5SidecarClient({ baseUrl: BASE_URL, token: TOKEN, fetchImpl });
    await client.isConnected();
    expect(capturedHeaders["X-MT5-Sidecar-Token"]).toBe(TOKEN);
  });
});
