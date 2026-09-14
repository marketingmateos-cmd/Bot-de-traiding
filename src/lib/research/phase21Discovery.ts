import type { OHLCVBar } from "@/lib/providers/types";
import { FROZEN_RANGES } from "./phase21PreRegistration";

/**
 * Fase 21 — barrera estructural Discovery ≠ Validation (misma exigencia
 * que Fase 20 Condición 2, aplicada al rango congelado de ESTA fase —
 * `phase20Discovery.ts` está atado a `phase20PreRegistration`'s
 * `FROZEN_RANGES`, que cubre un periodo distinto, así que no puede
 * reutilizarse aquí directamente; el patrón de tipo marcado + fábrica
 * validadora en runtime sí se reutiliza sin cambios).
 *
 * `IsOnlyBars` solo puede producirse mediante `tagAsIsOnly()`, que valida
 * en runtime que ningún bar del array sea posterior a
 * `FROZEN_RANGES.is.end` — no basta con confiar en que el código Discovery
 * "no los use": la firma del tipo y esta validación dificultan físicamente
 * la contaminación con datos de VALIDATION/OOS.
 */

const ISOnlyBrand: unique symbol = Symbol("phase21IsOnly");

export type IsOnlyBars = OHLCVBar[] & { readonly [ISOnlyBrand]: true };

export class DiscoveryContaminationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryContaminationError";
  }
}

export function tagAsIsOnly(bars: OHLCVBar[]): IsOnlyBars {
  if (bars.length === 0) {
    throw new DiscoveryContaminationError("Fase 21 Discovery: se recibió un array de bars vacío — nada que etiquetar como IS-only.");
  }

  const isEndMs = FROZEN_RANGES.is.end.getTime();
  let prevMs = -Infinity;
  for (const bar of bars) {
    const ms = bar.timestamp.getTime();
    if (ms < prevMs) {
      throw new DiscoveryContaminationError(`Fase 21 Discovery: los bars no están en orden cronológico (bar en ${bar.timestamp.toISOString()} llega después de uno posterior) — no se puede garantizar causalidad.`);
    }
    prevMs = ms;
    if (ms > isEndMs) {
      throw new DiscoveryContaminationError(
        `Fase 21 Discovery: bar en ${bar.timestamp.toISOString()} es posterior a FROZEN_RANGES.is.end (${FROZEN_RANGES.is.end.toISOString()}) — Discovery solo puede ver datos IS.`
      );
    }
  }

  return bars as IsOnlyBars;
}
