/**
 * Fase 20-D — Session / Time-of-Day Structural Effect. Deliberately
 * generic/parameterized: this module never imports `F20D_SESSIONS` (or any
 * other research-phase constant) directly, so `engines/` never depends on
 * `research/` — the caller passes its own frozen session list in. That
 * keeps the layering the same direction as every other engine module
 * (engines are reusable primitives; research/ orchestrates and freezes
 * parameters) and lets any future phase reuse this against a different,
 * independently-frozen session definition without editing this file.
 */

export interface SessionDefinition {
  name: string;
  /** Inclusive UTC hour [0-23] at which the session begins. */
  startHourUtc: number;
  /** Exclusive UTC hour [0-24] at which the session ends. */
  endHourUtcExclusive: number;
}

/**
 * Returns every session (by name) whose [start, end) window contains the
 * given UTC hour. A plural return because sessions may legitimately
 * overlap (e.g. LONDON/NY overlap is a standard, pre-registered market
 * convention, not a post-hoc partition) — the caller decides how to bucket
 * an hour that belongs to more than one session.
 */
export function getSessionsForHour(hourUtc: number, sessions: SessionDefinition[]): string[] {
  return sessions.filter((s) => hourUtc >= s.startHourUtc && hourUtc < s.endHourUtcExclusive).map((s) => s.name);
}

/** Same as `getSessionsForHour`, but takes a bar/decision timestamp directly. */
export function getSessionsForTimestamp(timestamp: Date, sessions: SessionDefinition[]): string[] {
  return getSessionsForHour(timestamp.getUTCHours(), sessions);
}
