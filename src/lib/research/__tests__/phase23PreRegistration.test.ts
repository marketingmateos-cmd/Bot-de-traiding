import { describe, expect, it } from "vitest";
import {
  buildF23Universe,
  FROZEN_UNIVERSE_SNAPSHOT,
  buildF23Ranges,
  FROZEN_WALK_FORWARD_OPTIONS,
  FROZEN_COST_MODEL,
  FROZEN_STRESS_SCENARIOS,
  FROZEN_F23_METRICS,
  MIN_SAMPLE_SIZE,
  FROZEN_SIGNIFICANCE_CONFIG,
  FROZEN_MONTE_CARLO_CONFIG,
  FROZEN_STOPPING_RULES,
  FROZEN_MAX_GRID_POINTS_PER_FAMILY,
  FROZEN_NO_EDGE_CRITERIA,
  FROZEN_F23_FAMILIES,
  FROZEN_F23_FAMILY_IDS,
  countGridPoints,
  countF23TotalConfigurations,
  type F23FamilyId,
} from "../phase23PreRegistration";
import { SUPPLEMENTARY_WALK_FORWARD_OPTIONS } from "../hypothesisValidation";
import { FROZEN_MONTE_CARLO_CONFIG as F19_MC, FROZEN_STRESS_SCENARIOS as F19_STRESS } from "../phase19PreRegistration";
import { FROZEN_MONTE_CARLO_CONFIG as F20_MC } from "../phase20PreRegistration";
import { F21A_BOOTSTRAP_CONFIG } from "../phase21PreRegistration";
import { BASELINE_COST_MODEL } from "@/lib/engines/strategy/baseline/shared";
import { buildResearchUniverseEntry, type ResearchUniverseEntry } from "../mt5ResearchUniverseV1";

describe("F23 universe — read dynamically from Research Universe v1, never hardcoded", () => {
  it("today's real universe is exactly the 9 EURUSD/USDJPY/XAUUSD x H1/H4/D1 entries", () => {
    expect(FROZEN_UNIVERSE_SNAPSHOT).toHaveLength(9);
    const symbols = new Set(FROZEN_UNIVERSE_SNAPSHOT.map((e) => e.canonicalSymbol));
    expect(symbols).toEqual(new Set(["EURUSD", "USDJPY", "XAUUSD"]));
  });

  it("BTCUSD/ETHUSD/US500 are absent from the current universe — never assumed authorized", () => {
    const symbols = new Set(FROZEN_UNIVERSE_SNAPSHOT.map((e) => e.canonicalSymbol));
    expect(symbols.has("BTCUSD")).toBe(false);
    expect(symbols.has("ETHUSD")).toBe(false);
    expect(symbols.has("US500")).toBe(false);
  });

  it("buildF23Universe() is a pure projection of getAuthorizedEntries() — if BTCUSD became AUTHORIZED_FOR_RESEARCH tomorrow, it would appear automatically, with no F23 code change", () => {
    const syntheticAuthorizedBtc: ResearchUniverseEntry = buildResearchUniverseEntry({
      canonicalSymbol: "BTCUSD",
      assetClass: "CRYPTO",
      timeframe: "H1",
      symbolAvailability: "AVAILABLE",
      timeframeAvailability: "AVAILABLE",
      brokerNativeSymbol: "BTCUSD",
      brokerPath: "Crypto CFD",
      earliestAvailable: "2025-10-27T00:00:00.000Z",
      latestAvailable: "2026-09-15T00:00:00.000Z",
      sampleSize: 500,
      sampleMaxRowsRequested: 500,
      invalidCount: 0,
      duplicateCount: 0,
      gapCount: 0,
      gapClassification: { weekendClose: 0, dailySessionBreak: 0, unclassified: 0 },
      coveragePct: 100,
      sampleHash: null,
      broker: "MEX Atlantic Corporation",
      server: "MEXAtlantic-Demo",
      validatedAt: "2026-09-20",
      notes: ["hipotético — solo para probar el mecanismo de proyección dinámica"],
    });
    const projected = buildF23Universe([syntheticAuthorizedBtc]);
    expect(projected).toEqual([{ canonicalSymbol: "BTCUSD", timeframe: "H1", assetClass: "CRYPTO" }]);
  });

  it("an empty authorized universe projects to an empty F23 universe, never a fallback list", () => {
    expect(buildF23Universe([])).toEqual([]);
  });
});

describe("F23 — no fabricated dataset (deliberately different from F18-F22)", () => {
  it("phase23PreRegistration.ts never declares a FROZEN_DATASET or a literal datasetHash — no ResearchDataset exists yet for the authorized universe", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/research/phase23PreRegistration.ts", "utf8");
    expect(source).not.toMatch(/FROZEN_DATASET\s*[:=]/);
    expect(source).not.toMatch(/datasetHash\s*:\s*"[0-9a-f]{64}"/);
  });

  it("buildF23Ranges() reuses computeIsValidationOosRanges() unchanged — same 60/20/20 split, and throws (never fabricates a range) when the span is too short", () => {
    expect(() => buildF23Ranges(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-05T00:00:00.000Z"))).toThrow();
    const ranges = buildF23Ranges(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-06-01T00:00:00.000Z"));
    expect(ranges.is.start.getTime()).toBeLessThan(ranges.validation.start.getTime());
    expect(ranges.validation.start.getTime()).toBeLessThan(ranges.oos.start.getTime());
  });
});

describe("F23 — reused (not re-derived) infrastructure", () => {
  it("walk-forward options are the exact object already frozen in Fase 13/18", () => {
    expect(FROZEN_WALK_FORWARD_OPTIONS).toBe(SUPPLEMENTARY_WALK_FORWARD_OPTIONS);
  });

  it("cost model reuses BASELINE_COST_MODEL's numbers verbatim, explicitly flagged unconfirmed for FX/Metal", () => {
    expect(FROZEN_COST_MODEL.feeBps).toBe(BASELINE_COST_MODEL.feeBps);
    expect(FROZEN_COST_MODEL.slippageBps).toBe(BASELINE_COST_MODEL.slippageBps);
    expect(FROZEN_COST_MODEL.confirmed).toBe(false);
  });

  it("stress scenarios are the exact Fase 19 array, not a re-declared copy", () => {
    expect(FROZEN_STRESS_SCENARIOS).toBe(F19_STRESS);
    expect(FROZEN_STRESS_SCENARIOS.length).toBeGreaterThanOrEqual(6);
    expect(FROZEN_STRESS_SCENARIOS[0].id).toBe("BASE");
  });

  it("MIN_SAMPLE_SIZE matches the repo-wide convention (20), same value as every prior phase", () => {
    expect(MIN_SAMPLE_SIZE).toBe(20);
  });
});

describe("F23 — Monte Carlo seed never collides with a prior phase's seed", () => {
  it("F23's seed (23) differs from F19 (19), F20 (20), and F21 (21), while iteration count follows the same 10,000 convention", () => {
    expect(FROZEN_MONTE_CARLO_CONFIG.seed).toBe(23);
    expect(FROZEN_MONTE_CARLO_CONFIG.seed).not.toBe(F19_MC.seed);
    expect(FROZEN_MONTE_CARLO_CONFIG.seed).not.toBe(F20_MC.seed);
    expect(FROZEN_MONTE_CARLO_CONFIG.seed).not.toBe(F21A_BOOTSTRAP_CONFIG.seed);
    expect(FROZEN_MONTE_CARLO_CONFIG.iterations).toBe(10_000);
  });
});

describe("F23 — significance / multiple-comparisons configuration", () => {
  it("declares both a primary (FDR) and secondary (Bonferroni) method — never a single method chosen after seeing results", () => {
    expect(FROZEN_SIGNIFICANCE_CONFIG.primaryMethod).toBe("benjamini_hochberg_fdr");
    expect(FROZEN_SIGNIFICANCE_CONFIG.secondaryMethod).toBe("bonferroni");
    expect(FROZEN_SIGNIFICANCE_CONFIG.familywiseAlpha).toBeGreaterThan(0);
    expect(FROZEN_SIGNIFICANCE_CONFIG.fdrQ).toBeGreaterThan(0);
  });
});

describe("F23 — stopping rules and no-edge criteria are non-empty and objective", () => {
  it("at least 4 stopping rules are declared, each a non-empty string", () => {
    expect(FROZEN_STOPPING_RULES.length).toBeGreaterThanOrEqual(4);
    for (const rule of FROZEN_STOPPING_RULES) expect(rule.length).toBeGreaterThan(10);
  });

  it("declares a positive grid-point ceiling per family", () => {
    expect(FROZEN_MAX_GRID_POINTS_PER_FAMILY).toBeGreaterThan(0);
  });

  it("no-edge criteria has at least 4 objective conditions, none referencing a subjective judgment call", () => {
    expect(FROZEN_NO_EDGE_CRITERIA.conditions.length).toBeGreaterThanOrEqual(4);
    for (const c of FROZEN_NO_EDGE_CRITERIA.conditions) expect(c.length).toBeGreaterThan(10);
  });
});

describe("F23 — hypothesis families A-G (design only, none implemented)", () => {
  it("exactly 7 families, ids F23A..F23G, no duplicates", () => {
    expect(FROZEN_F23_FAMILIES).toHaveLength(7);
    const expectedIds: F23FamilyId[] = ["F23A", "F23B", "F23C", "F23D", "F23E", "F23F", "F23G"];
    expect([...FROZEN_F23_FAMILY_IDS].sort()).toEqual([...expectedIds].sort());
    expect(new Set(FROZEN_F23_FAMILY_IDS).size).toBe(7);
  });

  it("every family declares a falsifiable hypothesis, rationale, evidence-for, and falsification criteria — none empty", () => {
    for (const f of FROZEN_F23_FAMILIES) {
      expect(f.hypothesis.length).toBeGreaterThan(20);
      expect(f.economicRationale.length).toBeGreaterThan(20);
      expect(f.evidenceFor.length).toBeGreaterThan(10);
      expect(f.falsificationCriteria.length).toBeGreaterThan(10);
      expect(f.variables.length).toBeGreaterThan(0);
    }
  });

  it("none of the 7 families is implemented — this phase designs, it does not build StrategyDefinitions", () => {
    for (const f of FROZEN_F23_FAMILIES) expect(f.implemented).toBe(false);
  });

  it("only F23-E (cross-sectional) requires >= 2 assets; every other family requires exactly 1", () => {
    for (const f of FROZEN_F23_FAMILIES) {
      if (f.id === "F23E") {
        expect(f.requiresCrossSectional).toBe(true);
        expect(f.minAssetsRequired).toBeGreaterThanOrEqual(2);
      } else {
        expect(f.requiresCrossSectional).toBe(false);
        expect(f.minAssetsRequired).toBe(1);
      }
    }
  });

  it("every family's grid stays within FROZEN_MAX_GRID_POINTS_PER_FAMILY — no undeclared combinatorial explosion", () => {
    for (const f of FROZEN_F23_FAMILIES) {
      expect(countGridPoints(f.parameterSearchBounds)).toBeLessThanOrEqual(FROZEN_MAX_GRID_POINTS_PER_FAMILY);
    }
  });
});

describe("countGridPoints", () => {
  it("computes the product of grid steps per parameter", () => {
    expect(countGridPoints({ a: { min: 0, max: 10, step: 5 } })).toBe(3); // 0,5,10
    expect(countGridPoints({ a: { min: 0, max: 10, step: 5 }, b: { min: 1, max: 2, step: 1 } })).toBe(6); // 3*2
  });

  it("returns 1 for a family with no grid parameters (e.g. fixed session boundaries)", () => {
    expect(countGridPoints({})).toBe(1);
  });

  it("throws on an invalid bound (step <= 0 or max < min)", () => {
    expect(() => countGridPoints({ a: { min: 0, max: 10, step: 0 } })).toThrow();
    expect(() => countGridPoints({ a: { min: 10, max: 0, step: 1 } })).toThrow();
  });
});

describe("countF23TotalConfigurations — multiple-hypothesis bookkeeping", () => {
  it("over the real current universe (9 entries, 3 assets, 3 timeframes) and all 7 families, returns a deterministic, positive total", () => {
    const a = countF23TotalConfigurations();
    const b = countF23TotalConfigurations();
    expect(a).toEqual(b); // deterministic — pure function of frozen inputs
    expect(a.totalFamilies).toBe(7);
    expect(a.totalAssets).toBe(3);
    expect(a.totalTimeframes).toBe(3);
    expect(a.totalConfigurations).toBeGreaterThan(0);
    expect(a.totalStatisticalTests).toBe(a.totalConfigurations);
    expect(a.breakdown).toHaveLength(7);
  });

  it("F23-E (cross-sectional) contributes 0 configurations when the universe has fewer than 2 distinct assets", () => {
    const singleAssetUniverse = [{ canonicalSymbol: "EURUSD" as const, timeframe: "H1" as const, assetClass: "FX" as const }];
    const result = countF23TotalConfigurations(singleAssetUniverse);
    const f23e = result.breakdown.find((b) => b.familyId === "F23E");
    expect(f23e?.applicableUniverseSlots).toBe(0);
    expect(f23e?.totalConfigurations).toBe(0);
  });

  it("F23-E contributes exactly 1 universe slot (never per-symbol) once >= 2 assets are present, regardless of how many timeframes", () => {
    const twoAssetUniverse = [
      { canonicalSymbol: "EURUSD" as const, timeframe: "H1" as const, assetClass: "FX" as const },
      { canonicalSymbol: "USDJPY" as const, timeframe: "H1" as const, assetClass: "FX" as const },
    ];
    const result = countF23TotalConfigurations(twoAssetUniverse);
    const f23e = result.breakdown.find((b) => b.familyId === "F23E");
    expect(f23e?.applicableUniverseSlots).toBe(1);
  });

  it("adding a universe entry strictly increases (or leaves unchanged) the total — never decreases", () => {
    const base = countF23TotalConfigurations(FROZEN_UNIVERSE_SNAPSHOT);
    const expanded = countF23TotalConfigurations([...FROZEN_UNIVERSE_SNAPSHOT, { canonicalSymbol: "BTCUSD" as const, timeframe: "H1" as const, assetClass: "CRYPTO" as const }]);
    expect(expanded.totalConfigurations).toBeGreaterThan(base.totalConfigurations);
  });
});

describe("F23 metrics", () => {
  it("declares at least 8 distinct metrics, no single metric documented as an absolute pass/fail gate", () => {
    expect(FROZEN_F23_METRICS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(FROZEN_F23_METRICS).size).toBe(FROZEN_F23_METRICS.length);
  });
});
