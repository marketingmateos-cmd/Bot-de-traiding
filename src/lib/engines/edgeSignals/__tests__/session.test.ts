import { describe, expect, it } from "vitest";
import { getSessionsForHour, getSessionsForTimestamp, type SessionDefinition } from "../session";

const SESSIONS: SessionDefinition[] = [
  { name: "ASIA", startHourUtc: 0, endHourUtcExclusive: 8 },
  { name: "LONDON", startHourUtc: 8, endHourUtcExclusive: 16 },
  { name: "NY", startHourUtc: 13, endHourUtcExclusive: 21 },
];

describe("getSessionsForHour", () => {
  it("classifies a pure-ASIA hour", () => {
    expect(getSessionsForHour(3, SESSIONS)).toEqual(["ASIA"]);
  });

  it("classifies the LONDON/NY overlap hour as both", () => {
    expect(getSessionsForHour(14, SESSIONS)).toEqual(["LONDON", "NY"]);
  });

  it("classifies an hour outside every session as empty", () => {
    expect(getSessionsForHour(22, SESSIONS)).toEqual([]);
  });

  it("honors exclusive session boundaries", () => {
    expect(getSessionsForHour(8, SESSIONS)).toEqual(["LONDON"]);
    expect(getSessionsForHour(7, SESSIONS)).toEqual(["ASIA"]);
  });
});

describe("getSessionsForTimestamp", () => {
  it("derives the UTC hour from a Date and classifies it", () => {
    const ts = new Date("2026-05-10T14:30:00.000Z");
    expect(getSessionsForTimestamp(ts, SESSIONS)).toEqual(["LONDON", "NY"]);
  });
});
