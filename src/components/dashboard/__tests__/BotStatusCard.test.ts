import { describe, expect, it } from "vitest";
import { computeWorkerHealth } from "../BotStatusCard";

// Fase 4 — "worker status" is distinct from the bot's ACTIVE/PAUSED trading
// intent: it reflects whether the persistent process's self-scheduling loop
// (botLoop.ts) is actually still heartbeating via BotConfig.lastRunAt,
// which updates every single cycle regardless of whether the bot traded.
describe("computeWorkerHealth", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("is UNKNOWN when the loop has never run", () => {
    expect(computeWorkerHealth(null, 60, now)).toBe("UNKNOWN");
  });

  it("is HEALTHY right after a heartbeat", () => {
    const lastRunAt = new Date(now - 5_000).toISOString();
    expect(computeWorkerHealth(lastRunAt, 60, now)).toBe("HEALTHY");
  });

  it("is HEALTHY for a heartbeat within a couple of missed intervals (tolerates one slow cycle)", () => {
    const lastRunAt = new Date(now - 150_000).toISOString(); // 2.5x a 60s interval
    expect(computeWorkerHealth(lastRunAt, 60, now)).toBe("HEALTHY");
  });

  it("is STALLED once the heartbeat is far older than the configured interval — the process likely died", () => {
    const lastRunAt = new Date(now - 400_000).toISOString(); // well past 3x60s+30s = 210s
    expect(computeWorkerHealth(lastRunAt, 60, now)).toBe("STALLED");
  });

  it("scales the staleness threshold with a longer configured interval instead of using a fixed cutoff", () => {
    // A 300s-interval bot heartbeating every 5 minutes is NOT stalled at
    // the same absolute age that would flag a 60s-interval bot.
    const lastRunAt = new Date(now - 400_000).toISOString();
    expect(computeWorkerHealth(lastRunAt, 300, now)).toBe("HEALTHY");
  });
});
