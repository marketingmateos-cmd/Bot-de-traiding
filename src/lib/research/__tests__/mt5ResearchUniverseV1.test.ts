import { describe, expect, it } from "vitest";
import {
  RESEARCH_UNIVERSE_V1,
  RESEARCH_UNIVERSE_V1_RULES,
  buildResearchUniverseEntry,
  getAuthorizedEntries,
  getPendingAuditEntries,
  getResearchUniverseEntry,
  validateResearchUniverseEntry,
  type ResearchUniverseEntry,
} from "../mt5ResearchUniverseV1";

const REQUIRED_KEYS: (keyof ResearchUniverseEntry)[] = [
  "canonicalSymbol",
  "assetClass",
  "timeframe",
  "symbolAvailability",
  "timeframeAvailability",
  "brokerNativeSymbol",
  "brokerPath",
  "earliestAvailable",
  "latestAvailable",
  "sampleSize",
  "sampleMaxRowsRequested",
  "invalidCount",
  "duplicateCount",
  "gapCount",
  "gapClassification",
  "pendingAuditGapCount",
  "coveragePct",
  "sampleHash",
  "broker",
  "server",
  "validatedAt",
  "provenance",
  "sampleQuality",
  "researchFitness",
  "pendingFields",
  "notes",
];

describe("MT5 Research Universe v1 — schema / structure", () => {
  it("has exactly 18 entries: 6 canonical symbols x 3 timeframes (H1/H4/D1), matching the confirmed candidate universe", () => {
    expect(RESEARCH_UNIVERSE_V1).toHaveLength(18);
    const symbols = new Set(RESEARCH_UNIVERSE_V1.map((e) => e.canonicalSymbol));
    expect(symbols).toEqual(new Set(["BTCUSD", "ETHUSD", "EURUSD", "USDJPY", "XAUUSD", "US500"]));
    for (const symbol of symbols) {
      const timeframes = RESEARCH_UNIVERSE_V1.filter((e) => e.canonicalSymbol === symbol).map((e) => e.timeframe);
      expect(new Set(timeframes)).toEqual(new Set(["H1", "H4", "D1"]));
    }
  });

  it("every entry carries every required field defined by the schema — no entry is missing a key", () => {
    for (const entry of RESEARCH_UNIVERSE_V1) {
      for (const key of REQUIRED_KEYS) {
        expect(entry).toHaveProperty(key);
      }
    }
  });

  it("assetClass is assigned correctly per the confirmed candidate universe grouping", () => {
    const byClass: Record<string, string[]> = { CRYPTO: [], FX: [], METAL: [], INDEX: [] };
    for (const entry of RESEARCH_UNIVERSE_V1) {
      if (!byClass[entry.assetClass].includes(entry.canonicalSymbol)) byClass[entry.assetClass].push(entry.canonicalSymbol);
    }
    expect(new Set(byClass.CRYPTO)).toEqual(new Set(["BTCUSD", "ETHUSD"]));
    expect(new Set(byClass.FX)).toEqual(new Set(["EURUSD", "USDJPY"]));
    expect(new Set(byClass.METAL)).toEqual(new Set(["XAUUSD"]));
    expect(new Set(byClass.INDEX)).toEqual(new Set(["US500"]));
  });

  it("every entry validates as structurally complete", () => {
    for (const entry of RESEARCH_UNIVERSE_V1) {
      const result = validateResearchUniverseEntry(entry);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });
});

describe("MT5 Research Universe v1 — determinism", () => {
  it("rebuilding the registry from the same raw facts is byte-for-byte identical (JSON) across calls", () => {
    // RESEARCH_UNIVERSE_V1 is a module-level constant, but the underlying
    // builder must be pure: calling it twice on the same raw facts object
    // must produce deep-equal results, never something that drifts (e.g.
    // a Date.now()-based field or non-deterministic ordering).
    const a = buildResearchUniverseEntry({ ...RESEARCH_UNIVERSE_V1[0] });
    const b = buildResearchUniverseEntry({ ...RESEARCH_UNIVERSE_V1[0] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("getResearchUniverseEntry() is deterministic and returns the same reference-equal-content entry every call", () => {
    const a = getResearchUniverseEntry("BTCUSD", "D1");
    const b = getResearchUniverseEntry("BTCUSD", "D1");
    expect(a).toBeDefined();
    expect(a).toEqual(b);
  });

  it("computed verdicts (sampleQuality/researchFitness/pendingFields) never vary run to run for the same input facts", () => {
    const raw = { ...RESEARCH_UNIVERSE_V1.find((e) => e.canonicalSymbol === "EURUSD" && e.timeframe === "D1")! };
    const results = Array.from({ length: 5 }, () => buildResearchUniverseEntry(raw));
    const [first, ...rest] = results;
    for (const r of rest) {
      expect(r.sampleQuality).toBe(first.sampleQuality);
      expect(r.researchFitness).toBe(first.researchFitness);
      expect(r.pendingFields).toEqual(first.pendingFields);
    }
  });
});

describe("MT5 Research Universe v1 — rejects incomplete/malformed records", () => {
  it("rejects an entry missing a required field entirely", () => {
    const incomplete = { ...RESEARCH_UNIVERSE_V1[0] } as Partial<ResearchUniverseEntry>;
    delete incomplete.canonicalSymbol;
    const result = validateResearchUniverseEntry(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("canonicalSymbol"))).toBe(true);
  });

  it("rejects a negative sampleSize/invalidCount/duplicateCount/gapCount", () => {
    for (const field of ["sampleSize", "invalidCount", "duplicateCount", "gapCount"] as const) {
      const malformed = { ...RESEARCH_UNIVERSE_V1[0], [field]: -1 };
      const result = validateResearchUniverseEntry(malformed);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes(field))).toBe(true);
    }
  });

  it("rejects provenance other than 'mt5_demo' — never silently accepts a mixed/foreign source", () => {
    const malformed = { ...RESEARCH_UNIVERSE_V1[0], provenance: "binance" as unknown as "mt5_demo" };
    const result = validateResearchUniverseEntry(malformed);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("provenance"))).toBe(true);
  });

  it("rejects a malformed sampleHash (not a 64-char hex digest, and not null)", () => {
    const malformed = { ...RESEARCH_UNIVERSE_V1[0], sampleHash: "not-a-real-hash" };
    const result = validateResearchUniverseEntry(malformed);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sampleHash"))).toBe(true);
  });

  it("rejects pendingAuditGapCount disagreeing with gapClassification.unclassified", () => {
    const malformed = { ...RESEARCH_UNIVERSE_V1[0], gapClassification: { weekendClose: null, dailySessionBreak: null, unclassified: 4 }, pendingAuditGapCount: 999 };
    const result = validateResearchUniverseEntry(malformed);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pendingAuditGapCount"))).toBe(true);
  });

  it("rejects an empty-string brokerNativeSymbol — null is the only valid 'not captured' representation", () => {
    const malformed = { ...RESEARCH_UNIVERSE_V1[0], brokerNativeSymbol: "" };
    const result = validateResearchUniverseEntry(malformed);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("brokerNativeSymbol"))).toBe(true);
  });

  it("accepts an entry with legitimately-null optional fields (null is NOT the same as incomplete)", () => {
    const stillValid = { ...RESEARCH_UNIVERSE_V1[0], sampleHash: null, coveragePct: null, gapCount: null };
    const result = validateResearchUniverseEntry(stillValid);
    expect(result.valid).toBe(true);
  });
});

describe("MT5 Research Universe v1 — broker-native symbol preservation (never invented)", () => {
  it("BTCUSD/ETHUSD/US500 carry their CONFIRMED exact-match broker-native symbol (never a guessed suffix)", () => {
    for (const symbol of ["BTCUSD", "ETHUSD", "US500"] as const) {
      for (const timeframe of ["H1", "H4", "D1"] as const) {
        const entry = getResearchUniverseEntry(symbol, timeframe);
        expect(entry?.brokerNativeSymbol).toBe(symbol);
      }
    }
  });

  it("EURUSD/USDJPY/XAUUSD carry brokerNativeSymbol=null — the exact broker-decorated leaf name was truncated in the source transcript and MUST NOT be fabricated", () => {
    for (const symbol of ["EURUSD", "USDJPY", "XAUUSD"] as const) {
      for (const timeframe of ["H1", "H4", "D1"] as const) {
        const entry = getResearchUniverseEntry(symbol, timeframe);
        expect(entry?.brokerNativeSymbol).toBeNull();
        expect(entry?.pendingFields).toContain("brokerNativeSymbol");
      }
    }
  });

  it("brokerPath (category) IS confirmed for every entry, even where the exact leaf symbol is not — distinct confirmation levels are never conflated", () => {
    expect(getResearchUniverseEntry("EURUSD", "H1")?.brokerPath).toBe("MB Pro\\Forex");
    expect(getResearchUniverseEntry("USDJPY", "H1")?.brokerPath).toBe("MB Pro\\Forex");
    expect(getResearchUniverseEntry("XAUUSD", "H1")?.brokerPath).toBe("MB Pro\\Gold");
    expect(getResearchUniverseEntry("BTCUSD", "H1")?.brokerPath).toBe("Crypto CFD");
    expect(getResearchUniverseEntry("US500", "H1")?.brokerPath).toBe("Cash indices");
  });
});

describe("MT5 Research Universe v1 — hash/provenance preservation", () => {
  it("every entry's provenance is exactly 'mt5_demo' — never mixed with Binance or any other source", () => {
    for (const entry of RESEARCH_UNIVERSE_V1) {
      expect(entry.provenance).toBe("mt5_demo");
    }
  });

  it("sampleHash is either null (not captured) or a valid 64-char lowercase hex SHA-256 digest — never a placeholder string", () => {
    for (const entry of RESEARCH_UNIVERSE_V1) {
      if (entry.sampleHash !== null) {
        expect(entry.sampleHash).toMatch(/^[0-9a-f]{64}$/);
      } else {
        expect(entry.pendingFields).toContain("sampleHash");
      }
    }
  });

  it("no entry currently carries a captured sampleHash (none was reported as an actual hex string in this session's real-run transcripts) — this is itself asserted so a future accidental fabrication is caught immediately", () => {
    for (const entry of RESEARCH_UNIVERSE_V1) {
      expect(entry.sampleHash).toBeNull();
    }
  });
});

describe("MT5 Research Universe v1 — unclassified gaps stay pending audit, never reclassified by assumption", () => {
  it("EURUSD D1 / USDJPY D1 / XAUUSD D1 / US500 H1 carry the EXACT confirmed unclassified counts", () => {
    expect(getResearchUniverseEntry("EURUSD", "D1")?.pendingAuditGapCount).toBe(4);
    expect(getResearchUniverseEntry("USDJPY", "D1")?.pendingAuditGapCount).toBe(4);
    expect(getResearchUniverseEntry("XAUUSD", "D1")?.pendingAuditGapCount).toBe(6);
    expect(getResearchUniverseEntry("US500", "H1")?.pendingAuditGapCount).toBe(2);
  });

  it("BTCUSD D1 / ETHUSD D1 carry the pre-fix 254 unclassified count, explicitly annotated as provisional in `notes` — never silently corrected to a guessed post-fix number", () => {
    const btc = getResearchUniverseEntry("BTCUSD", "D1");
    const eth = getResearchUniverseEntry("ETHUSD", "D1");
    expect(btc?.pendingAuditGapCount).toBe(254);
    expect(eth?.pendingAuditGapCount).toBe(254);
    expect(btc?.notes.some((n) => n.includes("BEFORE the classify_gap"))).toBe(true);
    expect(eth?.notes.some((n) => n.includes("BEFORE the classify_gap"))).toBe(true);
  });

  it("getPendingAuditEntries() returns exactly the entries with a known, positive pendingAuditGapCount", () => {
    const pending = getPendingAuditEntries();
    const expectedKeys = new Set(["BTCUSD/D1", "ETHUSD/D1", "EURUSD/D1", "USDJPY/D1", "XAUUSD/D1", "US500/H1"]);
    const actualKeys = new Set(pending.map((e) => `${e.canonicalSymbol}/${e.timeframe}`));
    expect(actualKeys).toEqual(expectedKeys);
  });

  it("a pending-audit gap count does NOT, by itself, block researchFitness — structural/unclassified gaps are a disclosed condition, not an automatic disqualification (unless invalid/duplicate rows are also present)", () => {
    const eurusdD1 = getResearchUniverseEntry("EURUSD", "D1");
    expect(eurusdD1?.pendingAuditGapCount).toBe(4);
    expect(eurusdD1?.invalidCount).toBe(0);
    expect(eurusdD1?.duplicateCount).toBe(0);
    expect(eurusdD1?.researchFitness).toBe("AUTHORIZED_FOR_RESEARCH");
    expect(eurusdD1?.sampleQuality).toBe("HAS_PENDING_AUDIT_GAPS");
  });
});

describe("MT5 Research Universe v1 — sampleQuality / researchFitness derivation", () => {
  it("an entry with no sample captured at all (sampleSize=null) is UNKNOWN quality and NOT authorized", () => {
    const btcH1 = getResearchUniverseEntry("BTCUSD", "H1");
    expect(btcH1?.sampleSize).toBeNull();
    expect(btcH1?.sampleQuality).toBe("UNKNOWN");
    expect(btcH1?.researchFitness).toBe("NOT_AUTHORIZED");
  });

  it("an entry with a validated sample, zero invalid/duplicate, and zero pending-audit gaps is CLEAN and authorized", () => {
    // No REAL entry in this v1 registry has a confirmed unclassified=0 (gap
    // breakdown either wasn't captured at all, or shows a known positive
    // count) — so this exercises the derivation directly via a synthetic
    // entry, the same way the NOT_FOUND case below does.
    const clean = buildResearchUniverseEntry({
      canonicalSymbol: "EURUSD", assetClass: "FX", timeframe: "H1",
      symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
      brokerNativeSymbol: "EURUSDm", brokerPath: "MB Pro\\Forex",
      earliestAvailable: "2017-04-03", latestAvailable: "2026-09-15",
      sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
      gapCount: 0, gapClassification: { weekendClose: 0, dailySessionBreak: 0, unclassified: 0 },
      coveragePct: 100, sampleHash: null, broker: "X", server: "Y", validatedAt: "2026-01-01", notes: [],
    });
    expect(clean.sampleQuality).toBe("CLEAN");
    expect(clean.researchFitness).toBe("AUTHORIZED_FOR_RESEARCH");
  });

  it("EURUSD H1's real gap breakdown was not captured (unclassified is null, not zero) — correctly UNKNOWN quality, never assumed clean", () => {
    const eurusdH1 = getResearchUniverseEntry("EURUSD", "H1");
    expect(eurusdH1?.gapClassification.unclassified).toBeNull();
    expect(eurusdH1?.sampleQuality).toBe("UNKNOWN");
    // Still authorized: UNKNOWN gap data doesn't block authorization, only a KNOWN invalid/duplicate row would.
    expect(eurusdH1?.researchFitness).toBe("AUTHORIZED_FOR_RESEARCH");
  });

  it("computeResearchFitness via buildResearchUniverseEntry never authorizes a NOT_FOUND symbol regardless of any other field", () => {
    const hypothetical = buildResearchUniverseEntry({
      canonicalSymbol: "EURUSD", assetClass: "FX", timeframe: "H1",
      symbolAvailability: "NOT_FOUND", timeframeAvailability: "AVAILABLE",
      brokerNativeSymbol: null, brokerPath: "MB Pro\\Forex",
      earliestAvailable: null, latestAvailable: null,
      sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
      gapCount: 0, gapClassification: { weekendClose: 0, dailySessionBreak: 0, unclassified: 0 },
      coveragePct: 100, sampleHash: null, broker: "X", server: "Y", validatedAt: "2026-01-01", notes: [],
    });
    expect(hypothetical.researchFitness).toBe("NOT_AUTHORIZED");
  });

  it("getAuthorizedEntries() excludes every entry whose sampleSize is null", () => {
    const authorized = getAuthorizedEntries();
    for (const entry of authorized) {
      expect(entry.sampleSize).not.toBeNull();
    }
    // Every BTCUSD/ETHUSD/US500 pair currently has sampleSize=null (not individually captured) -> none authorized yet.
    expect(authorized.some((e) => e.canonicalSymbol === "BTCUSD")).toBe(false);
    expect(authorized.some((e) => e.canonicalSymbol === "ETHUSD")).toBe(false);
    expect(authorized.some((e) => e.canonicalSymbol === "US500")).toBe(false);
    // All 9 EURUSD/USDJPY/XAUUSD pairs DO have a captured, clean sample -> authorized.
    expect(authorized).toHaveLength(9);
  });
});

describe("MT5 Research Universe v1 — research rules", () => {
  it("defines at least the 9 explicit rules from the spec, each with a stable id and non-empty description", () => {
    expect(RESEARCH_UNIVERSE_V1_RULES.length).toBeGreaterThanOrEqual(9);
    for (const rule of RESEARCH_UNIVERSE_V1_RULES) {
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }
    const ids = RESEARCH_UNIVERSE_V1_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate rule ids
  });

  it("covers the specific required topics: no-fill/no-interpolate, structural gaps aren't corruption, unclassified stays pending, cross-asset comparison, no single-asset robustness claim, no broker-native guessing", () => {
    const ids = new Set(RESEARCH_UNIVERSE_V1_RULES.map((r) => r.id));
    expect(ids.has("no-fill-no-interpolate")).toBe(true);
    expect(ids.has("structural-gaps-are-not-corruption")).toBe(true);
    expect(ids.has("unclassified-gaps-pending-audit")).toBe(true);
    expect(ids.has("no-cross-asset-comparison-without-declared-window")).toBe(true);
    expect(ids.has("no-single-asset-robustness-claim")).toBe(true);
    expect(ids.has("no-broker-native-symbol-guessing")).toBe(true);
    expect(ids.has("read-only-until-explicit-ingestion-phase")).toBe(true);
  });
});
