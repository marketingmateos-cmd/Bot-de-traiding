/**
 * MT5 RESEARCH UNIVERSE v1 — READ-ONLY registry.
 *
 * Formal, reproducible record of which (symbol, timeframe) pairs are
 * authorized for FUTURE research, built exclusively from what was
 * actually confirmed against a real MetaTrader 5 DEMO account (MEX
 * Atlantic Corporation) across the MT5 Data Connector phases already
 * committed on this branch — never from an assumption or a hardcoded
 * guess (see `brokerNativeSymbolConfirmed` and the `null`/`pendingFields`
 * convention below).
 *
 * THIS MODULE IS PURELY DECLARATIVE AND READ-ONLY:
 *   - It creates NO `ResearchDataset` row and touches no database.
 *   - It contains no MT5 API call of any kind — no `order_send`, no
 *     execution API, nothing that could reach a broker.
 *   - It does not download, resample, fill, or interpolate a single
 *     candle. Every numeric field here is either a number a real MT5
 *     script (`mt5_historical_discovery.py` / `mt5_symbol_resolution.py`)
 *     actually reported, or an explicit `null` meaning "not captured in
 *     this session — never invented as a placeholder."
 *   - `ENABLE_DEMO_EXECUTION` is untouched by this phase and remains
 *     `false`.
 *
 * See `docs/mt5-research-universe-v1.md` for the human-readable version
 * of this same registry and its rules, and
 * `src/lib/research/__tests__/mt5ResearchUniverseV1.test.ts` for the
 * tests that keep this file honest (schema completeness, determinism,
 * rejection of malformed entries, broker-native-symbol preservation,
 * hash/provenance preservation, pending-audit gap tracking).
 */

export type CanonicalSymbol = "BTCUSD" | "ETHUSD" | "EURUSD" | "USDJPY" | "XAUUSD" | "US500";
export type AssetClass = "CRYPTO" | "FX" | "METAL" | "INDEX";
export type ResearchTimeframe = "H1" | "H4" | "D1";
export type SymbolAvailability = "AVAILABLE" | "NOT_FOUND";
export type TimeframeAvailability = "AVAILABLE" | "NOT_AVAILABLE";
export type SampleQualityVerdict = "CLEAN" | "HAS_PENDING_AUDIT_GAPS" | "UNKNOWN";
export type ResearchFitnessVerdict = "AUTHORIZED_FOR_RESEARCH" | "NOT_AUTHORIZED";

/**
 * Every count here is `number | null` — `null` means "not independently
 * captured for this (symbol, timeframe) in this session's real runs",
 * never zero-by-default and never a guess. A `0` means a real script
 * reported exactly zero.
 */
export interface GapClassificationSummary {
  weekendClose: number | null;
  dailySessionBreak: number | null;
  unclassified: number | null;
}

const EMPTY_GAP_SUMMARY: GapClassificationSummary = { weekendClose: null, dailySessionBreak: null, unclassified: null };

/**
 * The RAW confirmed facts for one (symbol, timeframe) pair — exactly what
 * a human transcribed from a real MT5 run's output. Every field the real
 * run didn't report is `null` here, on purpose — `buildResearchUniverseEntry`
 * below never fills a gap in this data, only computes DERIVED verdicts
 * from whatever is actually present.
 */
interface RawEntryFacts {
  canonicalSymbol: CanonicalSymbol;
  assetClass: AssetClass;
  timeframe: ResearchTimeframe;
  symbolAvailability: SymbolAvailability;
  timeframeAvailability: TimeframeAvailability;
  /** The exact broker-decorated native symbol name, ONLY when the real value was captured — never a hardcoded suffix guess (spec: "no inventar un sufijo"). */
  brokerNativeSymbol: string | null;
  /** Confirmed broker category/path prefix (e.g. "Crypto CFD", "MB Pro\\Forex", "MB Pro\\Gold", "Cash indices"). */
  brokerPath: string;
  earliestAvailable: string | null;
  latestAvailable: string | null;
  sampleSize: number | null;
  sampleMaxRowsRequested: number;
  invalidCount: number | null;
  duplicateCount: number | null;
  gapCount: number | null;
  gapClassification: GapClassificationSummary;
  coveragePct: number | null;
  sampleHash: string | null;
  broker: string | null;
  server: string | null;
  validatedAt: string;
  /** Free-text notes on exactly what is/isn't confirmed for this entry — never used by any computed verdict, purely for human/audit context. */
  notes: string[];
}

export interface ResearchUniverseEntry extends RawEntryFacts {
  provenance: "mt5_demo";
  /** `gapClassification.unclassified`, surfaced as its own top-level field so "pending audit" is impossible to overlook (spec requirement: gaps unclassified quedan marcados para auditoría). `null` when unclassified count itself isn't known. */
  pendingAuditGapCount: number | null;
  sampleQuality: SampleQualityVerdict;
  researchFitness: ResearchFitnessVerdict;
  /** Auto-derived (never hand-maintained) list of field names that are `null`/not yet confirmed on this entry. */
  pendingFields: string[];
}

// ── Derivation (pure, deterministic — recomputing from the same RawEntryFacts always gives the same result) ──

function computeSampleQuality(raw: RawEntryFacts): SampleQualityVerdict {
  if (raw.invalidCount === null || raw.duplicateCount === null || raw.gapClassification.unclassified === null) return "UNKNOWN";
  if (raw.invalidCount > 0 || raw.duplicateCount > 0) return "HAS_PENDING_AUDIT_GAPS"; // invalid/duplicate rows are themselves a reason for review, same bucket as unclassified gaps — never silently "clean"
  return raw.gapClassification.unclassified > 0 ? "HAS_PENDING_AUDIT_GAPS" : "CLEAN";
}

/**
 * AUTHORIZED_FOR_RESEARCH requires: the symbol and timeframe both exist on
 * the broker, AND a validated sample exists (sampleSize known) with zero
 * KNOWN invalid/duplicate rows. It does NOT require zero `unclassified`
 * gaps — per the explicit rule that weekend/session closures (and even an
 * unclassified gap pending audit) are not, by themselves, disqualifying
 * data corruption; they are a disclosed condition attached to the
 * authorization (see `pendingAuditGapCount` and RESEARCH_UNIVERSE_V1_RULES).
 * It also does not require `earliestAvailable`/`latestAvailable` — those
 * describe DEPTH, a separate concern a researcher applies afterward
 * (RULE "timeframe-depth-window"), not a basic authorization gate.
 */
function computeResearchFitness(raw: RawEntryFacts): ResearchFitnessVerdict {
  if (raw.symbolAvailability !== "AVAILABLE" || raw.timeframeAvailability !== "AVAILABLE") return "NOT_AUTHORIZED";
  if (raw.sampleSize === null) return "NOT_AUTHORIZED"; // never authorize without at least one validated sample
  if ((raw.invalidCount ?? 0) > 0) return "NOT_AUTHORIZED";
  if ((raw.duplicateCount ?? 0) > 0) return "NOT_AUTHORIZED";
  return "AUTHORIZED_FOR_RESEARCH";
}

const NULLABLE_FIELD_NAMES = ["brokerNativeSymbol", "earliestAvailable", "latestAvailable", "sampleSize", "invalidCount", "duplicateCount", "gapCount", "coveragePct", "sampleHash", "broker", "server"] as const;

function computePendingFields(raw: RawEntryFacts): string[] {
  const pending: string[] = [];
  for (const field of NULLABLE_FIELD_NAMES) {
    if (raw[field] === null) pending.push(field);
  }
  if (raw.gapClassification.weekendClose === null) pending.push("gapClassification.weekendClose");
  if (raw.gapClassification.dailySessionBreak === null) pending.push("gapClassification.dailySessionBreak");
  if (raw.gapClassification.unclassified === null) pending.push("gapClassification.unclassified");
  return pending;
}

export function buildResearchUniverseEntry(raw: RawEntryFacts): ResearchUniverseEntry {
  return {
    ...raw,
    provenance: "mt5_demo",
    pendingAuditGapCount: raw.gapClassification.unclassified,
    sampleQuality: computeSampleQuality(raw),
    researchFitness: computeResearchFitness(raw),
    pendingFields: computePendingFields(raw),
  };
}

// ── Raw confirmed facts, one entry per (canonical symbol, timeframe) ──
// Every non-null value below was reported by a real run against the MEX
// Atlantic Corporation MT5 DEMO account (server "MEXAtlantic-Demo") within
// this branch's MT5 Data Connector phases. Nothing here is a projection,
// an estimate treated as a fact, or a guessed broker-native suffix.

const BROKER = "MEX Atlantic Corporation";
const SERVER = "MEXAtlantic-Demo";
const VALIDATED_AT = "2026-09-15";

const RAW_ENTRIES: RawEntryFacts[] = [
  // ── BTCUSD (Crypto CFD) — exact-match broker-native symbol, no resolution ambiguity ──
  {
    canonicalSymbol: "BTCUSD", assetClass: "CRYPTO", timeframe: "H1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "BTCUSD", brokerPath: "Crypto CFD",
    earliestAvailable: "2025-10-27", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["earliest/latest confirmed via mt5_historical_discovery.py real run (9/15 pairs OK)", "sample-level counts (size/invalid/duplicate/gaps/hash) were not individually reported for this pair — capture via --json-out before relying on sampleQuality/researchFitness beyond symbol/timeframe availability"],
  },
  {
    canonicalSymbol: "BTCUSD", assetClass: "CRYPTO", timeframe: "H4",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "BTCUSD", brokerPath: "Crypto CFD",
    earliestAvailable: "2020-12-16", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["earliest/latest confirmed; sample-level counts not individually reported for this pair"],
  },
  {
    canonicalSymbol: "BTCUSD", assetClass: "CRYPTO", timeframe: "D1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "BTCUSD", brokerPath: "Crypto CFD",
    earliestAvailable: "2020-12-16", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: { weekendClose: null, dailySessionBreak: null, unclassified: 254 }, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: [
      "254 unclassified gaps reported BEFORE the classify_gap() D1 hour-gate fix (commit 80b7bc8) — investigated and traced to a real bug (D1 bars are always stamped 00:00, so the old Friday-hour>=12 weekend check could never fire for D1); most of these are very likely ordinary weekly closures, not data corruption, but this has NOT been independently re-confirmed with a post-fix real run",
      "reported jointly for BTCUSD/ETHUSD D1 in the same message — both symbols share the same date range and (as a crypto CFD pair on the same broker) very likely the same weekly-closure calendar structure, but the exact figure has not been independently attributed per-symbol; treat 254 as provisional for BOTH until re-verified separately",
      "weekendClose/dailySessionBreak breakdown not captured — only the unclassified count is known",
    ],
  },

  // ── ETHUSD (Crypto CFD) ──
  {
    canonicalSymbol: "ETHUSD", assetClass: "CRYPTO", timeframe: "H1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "ETHUSD", brokerPath: "Crypto CFD",
    earliestAvailable: "2025-11-01", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["earliest/latest confirmed; sample-level counts not individually reported for this pair"],
  },
  {
    canonicalSymbol: "ETHUSD", assetClass: "CRYPTO", timeframe: "H4",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "ETHUSD", brokerPath: "Crypto CFD",
    earliestAvailable: "2020-12-16", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["earliest/latest confirmed; sample-level counts not individually reported for this pair"],
  },
  {
    canonicalSymbol: "ETHUSD", assetClass: "CRYPTO", timeframe: "D1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "ETHUSD", brokerPath: "Crypto CFD",
    earliestAvailable: "2020-12-16", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: { weekendClose: null, dailySessionBreak: null, unclassified: 254 }, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: [
      "254 unclassified gaps reported jointly with BTCUSD D1, BEFORE the classify_gap() D1 fix — see BTCUSD D1's notes; same provisional/joint-attribution caveat applies",
      "weekendClose/dailySessionBreak breakdown not captured — only the unclassified count is known",
    ],
  },

  // ── US500 (Cash indices) — exact-match broker-native symbol ──
  {
    canonicalSymbol: "US500", assetClass: "INDEX", timeframe: "H1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "US500", brokerPath: "Cash indices",
    earliestAvailable: "2016-05-05", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: { weekendClose: null, dailySessionBreak: null, unclassified: 2 }, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: [
      "2 unclassified H1 gaps confirmed (real run) — cause not determined; most likely a public holiday, a DST transition, or a longer-than-usual maintenance window; NOT reclassified by assumption per spec requirement 6/7",
      "weekendClose/dailySessionBreak breakdown not captured — only the unclassified count is known",
    ],
  },
  {
    canonicalSymbol: "US500", assetClass: "INDEX", timeframe: "H4",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "US500", brokerPath: "Cash indices",
    earliestAvailable: "2016-05-05", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["earliest/latest confirmed; gap breakdown not individually reported for H4"],
  },
  {
    canonicalSymbol: "US500", assetClass: "INDEX", timeframe: "D1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: "US500", brokerPath: "Cash indices",
    earliestAvailable: "2016-05-05", latestAvailable: "2026-09-15",
    sampleSize: null, sampleMaxRowsRequested: 2000, invalidCount: null, duplicateCount: null,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["earliest/latest confirmed; gap breakdown not individually reported for D1 — the classify_gap() D1 fix (commit 80b7bc8) applies here too and has not yet been re-verified against a real run"],
  },

  // ── EURUSD (MB Pro\Forex) — resolved via broker metadata, exact native leaf name NOT captured ──
  {
    canonicalSymbol: "EURUSD", assetClass: "FX", timeframe: "H1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Forex",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: [
      "exact broker-native leaf name was reported truncated (\"EURUSD...\") in the source message — NEVER guessed; resolve via `python mt5_symbol_resolution.py --json-out` and update brokerNativeSymbol/brokerNativeSymbolConfirmed from that real output before this field is relied on",
      "sampleSize/invalidCount/duplicateCount confirmed as part of the aggregate '9/9 pairs OK, 500/500 valid, 0 duplicates' real-run report",
      "latestAvailable not independently restated for this symbol in the source message (only earliest was) — left null rather than assumed equal to the crypto/index entries' 2026-09-15",
    ],
  },
  {
    canonicalSymbol: "EURUSD", assetClass: "FX", timeframe: "H4",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Forex",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["same broker-native-symbol caveat as EURUSD H1", "gap breakdown not individually reported for H4"],
  },
  {
    canonicalSymbol: "EURUSD", assetClass: "FX", timeframe: "D1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Forex",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: { weekendClose: null, dailySessionBreak: null, unclassified: 4 }, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["same broker-native-symbol caveat as EURUSD H1", "4 unclassified D1 gaps confirmed — kept pending audit, NOT reclassified by assumption (spec requirement 6)"],
  },

  // ── USDJPY (MB Pro\Forex) ──
  {
    canonicalSymbol: "USDJPY", assetClass: "FX", timeframe: "H1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Forex",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["exact broker-native leaf name truncated in source (\"USDJPY...\") — never guessed", "sampleSize/invalidCount/duplicateCount from the aggregate '9/9 pairs OK' report"],
  },
  {
    canonicalSymbol: "USDJPY", assetClass: "FX", timeframe: "H4",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Forex",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["same broker-native-symbol caveat as USDJPY H1"],
  },
  {
    canonicalSymbol: "USDJPY", assetClass: "FX", timeframe: "D1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Forex",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: { weekendClose: null, dailySessionBreak: null, unclassified: 4 }, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["same broker-native-symbol caveat as USDJPY H1", "4 unclassified D1 gaps confirmed — kept pending audit"],
  },

  // ── XAUUSD (MB Pro\Gold) ──
  {
    canonicalSymbol: "XAUUSD", assetClass: "METAL", timeframe: "H1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Gold",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["exact broker-native leaf name truncated in source (\"XAUUSD...\") — never guessed", "resolved via XAUUSD root directly (no GOLD fallback needed, per the confirmed \"MB Pro\\Gold\\XAUUSD...\" path)"],
  },
  {
    canonicalSymbol: "XAUUSD", assetClass: "METAL", timeframe: "H4",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Gold",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: EMPTY_GAP_SUMMARY, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["same broker-native-symbol caveat as XAUUSD H1"],
  },
  {
    canonicalSymbol: "XAUUSD", assetClass: "METAL", timeframe: "D1",
    symbolAvailability: "AVAILABLE", timeframeAvailability: "AVAILABLE",
    brokerNativeSymbol: null, brokerPath: "MB Pro\\Gold",
    earliestAvailable: "2017-04-03", latestAvailable: null,
    sampleSize: 500, sampleMaxRowsRequested: 500, invalidCount: 0, duplicateCount: 0,
    gapCount: null, gapClassification: { weekendClose: null, dailySessionBreak: null, unclassified: 6 }, coveragePct: null, sampleHash: null,
    broker: BROKER, server: SERVER, validatedAt: VALIDATED_AT,
    notes: ["same broker-native-symbol caveat as XAUUSD H1", "6 unclassified D1 gaps confirmed — kept pending audit"],
  },
];

/** The full v1 registry — 6 canonical symbols x 3 timeframes = 18 entries, built deterministically from `RAW_ENTRIES`. */
export const RESEARCH_UNIVERSE_V1: readonly ResearchUniverseEntry[] = RAW_ENTRIES.map(buildResearchUniverseEntry);

// ── Query helpers (read-only — never mutate RESEARCH_UNIVERSE_V1) ──

export function getResearchUniverseEntry(symbol: CanonicalSymbol, timeframe: ResearchTimeframe): ResearchUniverseEntry | undefined {
  return RESEARCH_UNIVERSE_V1.find((e) => e.canonicalSymbol === symbol && e.timeframe === timeframe);
}

export function getAuthorizedEntries(): readonly ResearchUniverseEntry[] {
  return RESEARCH_UNIVERSE_V1.filter((e) => e.researchFitness === "AUTHORIZED_FOR_RESEARCH");
}

export function getPendingAuditEntries(): readonly ResearchUniverseEntry[] {
  return RESEARCH_UNIVERSE_V1.filter((e) => (e.pendingAuditGapCount ?? 0) > 0);
}

// ── Validation — rejects a structurally malformed/incomplete entry. ──
// A `null` in a legitimately-nullable field is NOT malformed (it's an
// honestly-declared "not captured yet"); what's rejected is a MISSING
// required key, a wrong type, or an internally inconsistent value (e.g. a
// negative count, or pendingAuditGapCount disagreeing with
// gapClassification.unclassified).

const REQUIRED_NON_NULL_KEYS = ["canonicalSymbol", "assetClass", "timeframe", "provenance", "validatedAt", "symbolAvailability", "timeframeAvailability", "brokerPath", "sampleMaxRowsRequested", "sampleQuality", "researchFitness", "pendingFields", "notes"] as const;

export interface ResearchUniverseValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateResearchUniverseEntry(entry: Partial<ResearchUniverseEntry>): ResearchUniverseValidationResult {
  const errors: string[] = [];

  for (const key of REQUIRED_NON_NULL_KEYS) {
    if (entry[key] === undefined || entry[key] === null) errors.push(`missing required field: ${key}`);
  }

  if (entry.provenance !== undefined && entry.provenance !== "mt5_demo") errors.push(`provenance must be "mt5_demo" (got ${JSON.stringify(entry.provenance)}) — never mixed with a non-MT5 source`);

  for (const field of ["sampleSize", "invalidCount", "duplicateCount", "gapCount", "pendingAuditGapCount"] as const) {
    const value = entry[field];
    if (typeof value === "number" && value < 0) errors.push(`${field} cannot be negative (got ${value})`);
  }

  if (entry.sampleHash !== undefined && entry.sampleHash !== null && !/^[0-9a-f]{64}$/.test(entry.sampleHash)) {
    errors.push(`sampleHash must be a 64-character lowercase hex SHA-256 digest or null (got ${JSON.stringify(entry.sampleHash)})`);
  }

  if (entry.gapClassification !== undefined && entry.pendingAuditGapCount !== undefined) {
    const unclassified = entry.gapClassification.unclassified;
    if (unclassified !== null && entry.pendingAuditGapCount !== null && unclassified !== entry.pendingAuditGapCount) {
      errors.push(`pendingAuditGapCount (${entry.pendingAuditGapCount}) must equal gapClassification.unclassified (${unclassified})`);
    }
  }

  if (entry.brokerNativeSymbol != null && entry.brokerNativeSymbol.trim() === "") {
    errors.push("brokerNativeSymbol, when non-null, must not be an empty string — use null for 'not captured', never an empty placeholder");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Research rules — the explicit conditions that MUST hold for any FUTURE
 * research built on this universe (spec requirement 3). These are
 * documentation-as-data: each rule has a stable `id` for other modules or
 * a future pre-registration file to reference/cite, never re-derive.
 */
export interface ResearchUniverseRule {
  id: string;
  description: string;
}

export const RESEARCH_UNIVERSE_V1_RULES: readonly ResearchUniverseRule[] = [
  {
    id: "no-cross-asset-comparison-without-declared-window",
    description: "No comparar directamente estrategias entre activos si sus ventanas históricas (earliestAvailable/latestAvailable por símbolo+timeframe) no son equivalentes, sin declarar explícitamente la diferencia de cobertura.",
  },
  {
    id: "no-timeframe-window-beyond-depth",
    description: "No usar un timeframe como ventana multianual si su earliestAvailable conocido no soporta esa ventana — p.ej. BTCUSD/ETHUSD H1 solo tienen profundidad confirmada desde 2025-10/11, nunca asumir años de historia H1 para esos símbolos.",
  },
  {
    id: "no-fill-no-interpolate",
    description: "Nunca rellenar ni interpolar velas faltantes bajo ninguna circunstancia — un gap se reporta, nunca se sintetiza.",
  },
  {
    id: "structural-gaps-are-not-corruption",
    description: "Un gap clasificado como weekend_close o daily_session_break no debe tratarse automáticamente como corrupción de datos — es estructura de mercado esperada, documentada explícitamente.",
  },
  {
    id: "unclassified-gaps-pending-audit",
    description: "Los gaps unclassified deben conservarse y quedar marcados como pendientes de auditoría (ver pendingAuditGapCount) — nunca reclasificados por suposición, nunca descartados en silencio.",
  },
  {
    id: "future-datasets-preserve-full-provenance",
    description: "Todo ResearchDataset futuro construido sobre este universo debe conservar canonicalSymbol + brokerNativeSymbol + timeframe + timestamps + provenance ('mt5_demo') + datasetHash — nunca solo el símbolo canónico.",
  },
  {
    id: "no-single-asset-robustness-claim",
    description: "Una estrategia no puede declararse robusta únicamente porque funciona en un único activo/timeframe de este universo — requiere validación cruzada, igual que F17-F22 ya exigen para los activos cripto existentes.",
  },
  {
    id: "no-broker-native-symbol-guessing",
    description: "Nunca usar un sufijo/nombre de símbolo broker-native inventado. Si brokerNativeSymbol es null en este registro, resolver primero con mt5_symbol_resolution.py contra el broker real y actualizar el registro — nunca asumir un patrón de otro bróker o de otro símbolo.",
  },
  {
    id: "read-only-until-explicit-ingestion-phase",
    description: "Este registro es exclusivamente de lectura/planificación. Ningún símbolo/timeframe aquí listado se ingiere, descarga en volumen, ni se registra como ResearchDataset solo por aparecer con researchFitness AUTHORIZED_FOR_RESEARCH — eso requiere una fase de ingestión explícita y separada.",
  },
] as const;
