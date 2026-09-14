import type { OHLCVBar } from "@/lib/providers/types";
import { FROZEN_RANGES } from "./phase20PreRegistration";

/**
 * Fase 20 — Discovery ≠ Validation structural barrier (spec Condición 2).
 *
 * "No basta con confiar en que el código 'no los use'." — so this is not a
 * documentation convention, it is a type-level contract: `IsOnlyBars` is a
 * branded type that TypeScript will not let anything produce except by
 * calling `tagAsIsOnly()`, and that function throws at RUNTIME if it is
 * ever handed a single bar dated after `FROZEN_RANGES.is.end`. Any
 * Discovery-stage function that wants to be honest about only touching IS
 * data should type its `bars` parameter as `IsOnlyBars` instead of plain
 * `OHLCVBar[]` — a caller trying to pass raw VALIDATION/OOS bars in gets a
 * compile error, and a caller trying to route validation-range bars
 * THROUGH `tagAsIsOnly()` to defeat the type check gets a thrown
 * `DiscoveryContaminationError` instead.
 */

const ISOnlyBrand: unique symbol = Symbol("phase20IsOnly");

export type IsOnlyBars = OHLCVBar[] & { readonly [ISOnlyBrand]: true };

export class DiscoveryContaminationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryContaminationError";
  }
}

/**
 * The ONLY way to produce an `IsOnlyBars` value. Validates every bar's
 * timestamp against the frozen `FROZEN_RANGES.is.end` boundary (the same
 * IS/VALIDATION/OOS partition Fase 13/18/19 already freeze — never
 * redefined here) and throws `DiscoveryContaminationError` the instant any
 * bar is found dated after that boundary. Bars must also be non-empty and
 * in chronological order, matching every other replay/discovery entry
 * point's existing assumption.
 */
export function tagAsIsOnly(bars: OHLCVBar[]): IsOnlyBars {
  if (bars.length === 0) {
    throw new DiscoveryContaminationError("Fase 20 Discovery: se recibió un array de bars vacío — nada que etiquetar como IS-only.");
  }

  const isEndMs = FROZEN_RANGES.is.end.getTime();
  let prevMs = -Infinity;
  for (const bar of bars) {
    const ms = bar.timestamp.getTime();
    if (ms < prevMs) {
      throw new DiscoveryContaminationError(`Fase 20 Discovery: los bars no están en orden cronológico (bar en ${bar.timestamp.toISOString()} llega después de uno posterior) — no se puede garantizar causalidad.`);
    }
    prevMs = ms;
    if (ms > isEndMs) {
      throw new DiscoveryContaminationError(
        `Fase 20 Discovery: bar en ${bar.timestamp.toISOString()} es posterior a FROZEN_RANGES.is.end (${FROZEN_RANGES.is.end.toISOString()}) — Discovery solo puede ver datos IS. Esto es la barrera estructural de la Condición 2, no un fallo recuperable.`,
      );
    }
  }

  return bars as IsOnlyBars;
}
