import { describe, expect, it, afterEach } from "vitest";
import { getMt5CredentialsFromEnv, Mt5ConfigError } from "../mt5CredentialConfig";

const KEYS = ["MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"] as const;
const ORIGINAL: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function clearAll() {
  for (const k of KEYS) delete process.env[k];
}
function restoreAll() {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
}
afterEach(restoreAll);

describe("MT5 Data Connector — getMt5CredentialsFromEnv (spec section 1)", () => {
  it("throws Mt5ConfigError with the exact safe message when all three are missing", () => {
    clearAll();
    expect(() => getMt5CredentialsFromEnv()).toThrow(Mt5ConfigError);
    expect(() => getMt5CredentialsFromEnv()).toThrow("MT5 configuration is incomplete");
  });

  it("throws when only MT5_LOGIN is missing", () => {
    clearAll();
    process.env.MT5_PASSWORD = "hunter2";
    process.env.MT5_SERVER = "Demo-Server";
    expect(() => getMt5CredentialsFromEnv()).toThrow(Mt5ConfigError);
  });

  it("throws when only MT5_PASSWORD is missing", () => {
    clearAll();
    process.env.MT5_LOGIN = "12345";
    process.env.MT5_SERVER = "Demo-Server";
    expect(() => getMt5CredentialsFromEnv()).toThrow(Mt5ConfigError);
  });

  it("throws when only MT5_SERVER is missing", () => {
    clearAll();
    process.env.MT5_LOGIN = "12345";
    process.env.MT5_PASSWORD = "hunter2";
    expect(() => getMt5CredentialsFromEnv()).toThrow(Mt5ConfigError);
  });

  it("the error message never names which specific variable is missing", () => {
    clearAll();
    process.env.MT5_LOGIN = "12345";
    try {
      getMt5CredentialsFromEnv();
      throw new Error("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toMatch(/MT5_PASSWORD/);
      expect(message).not.toMatch(/MT5_SERVER/);
      expect(message).not.toMatch(/MT5_LOGIN/);
    }
  });

  it("returns the credentials unchanged when all three are present", () => {
    clearAll();
    process.env.MT5_LOGIN = "7654321";
    process.env.MT5_PASSWORD = "correct-horse-battery-staple";
    process.env.MT5_SERVER = "BrokerX-Demo";
    const credentials = getMt5CredentialsFromEnv();
    expect(credentials).toEqual({ login: "7654321", password: "correct-horse-battery-staple", server: "BrokerX-Demo" });
  });

  it("credentials are never logged: no console call during a failing read ever contains the configured password", () => {
    clearAll();
    process.env.MT5_PASSWORD = "super-secret-marker-xyz";
    // Only LOGIN/SERVER missing here — password IS set but the function must
    // still fail closed (all three required) without ever echoing it anywhere.
    const originalLog = console.log;
    const originalError = console.error;
    const seen: string[] = [];
    console.log = (...args: unknown[]) => seen.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => seen.push(args.map(String).join(" "));
    try {
      expect(() => getMt5CredentialsFromEnv()).toThrow(Mt5ConfigError);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    expect(seen.join("\n")).not.toMatch(/super-secret-marker-xyz/);
  });
});
