import { FROZEN_RANGES } from "./phase21PreRegistration";
import type { OHLCVBar, TimeframeCode } from "@/lib/providers/types";

/**
 * Fase 22 — Multi-Timeframe Validation. Extiende Discovery/Validation/OOS
 * (ya construidos en Fase 21, reutilizados SIN modificar ni un umbral) a
 * BTC/ETH H4 y D1 — los mismos datasets resampleados y registrados como
 * `ResearchDataset` en el commit anterior ("extender BTC/ETH a H4/D1").
 *
 * Congelación total ANTES de correr Discovery sobre H4/D1: identidad de
 * los 4 datasets (hash verificado independientemente en Checkpoint 1),
 * y — deliberadamente — los MISMOS `FROZEN_RANGES` (fechas de calendario)
 * y los MISMOS umbrales/ventanas de F21 (F21A_LAGS_HOURS, F21B_*, F21C_*,
 * F21D_*, F21E_*), importados sin redefinir, para que:
 *   (a) la comparación IS/VALIDATION/OOS use exactamente el mismo corte de
 *       calendario en las 3 resoluciones (H1/H4/D1) — necesario para que
 *       la "comparación incremental H4/D1 vs H1" (spec punto 10) sea
 *       realmente una comparación como-para-como, no un corte distinto
 *       elegido después de ver los datos de cada timeframe; y
 *   (b) no se re-sintonice ningún umbral por timeframe (spec punto 6:
 *       "congela fórmulas/thresholds/ventanas" — la interpretación de
 *       "horizonte=6" pasa a ser "6 barras H4" (24h) o "6 barras D1" (6
 *       días) en vez de "6 horas", que es precisamente lo que se está
 *       poniendo a prueba: si el mismo patrón, con la misma definición
 *       en barras, sobrevive a otra resolución — no una versión ajustada
 *       a mano para "tener sentido económico" en cada timeframe.
 */

export const FROZEN_DATASET_BTC_H4 = {
  symbol: "BTC", timeframe: "H4" as const,
  startDate: new Date("2023-01-01T00:00:00.000Z"), endDate: new Date("2026-08-31T20:00:00.000Z"),
  rowCount: 8033, gapCount: 1, duplicateCount: 0, coveragePct: 99.98755290017426,
  isDemo: false, source: "binance_csv_resampled_h1",
  datasetHash: "2fdb92b57f0bbc3f7b4370e4571986ddc94275cc265685df5a64d280f2b67d89",
};

export const FROZEN_DATASET_ETH_H4 = {
  symbol: "ETH", timeframe: "H4" as const,
  startDate: new Date("2023-01-01T00:00:00.000Z"), endDate: new Date("2026-08-31T20:00:00.000Z"),
  rowCount: 8033, gapCount: 1, duplicateCount: 0, coveragePct: 99.98755290017426,
  isDemo: false, source: "binance_csv_resampled_h1",
  datasetHash: "92bd6108001e78de833b2c82c4691b06ea7a254a84276d3e6eb9454991923de3",
};

export const FROZEN_DATASET_BTC_D1 = {
  symbol: "BTC", timeframe: "D1" as const,
  startDate: new Date("2023-01-01T00:00:00.000Z"), endDate: new Date("2026-08-31T00:00:00.000Z"),
  rowCount: 1338, gapCount: 1, duplicateCount: 0, coveragePct: 99.92531740104556,
  isDemo: false, source: "binance_csv_resampled_h1",
  datasetHash: "018f534308ce46d56fdac0417af51f1cee91805ad2f0946a78e2fa49caa0f176",
};

export const FROZEN_DATASET_ETH_D1 = {
  symbol: "ETH", timeframe: "D1" as const,
  startDate: new Date("2023-01-01T00:00:00.000Z"), endDate: new Date("2026-08-31T00:00:00.000Z"),
  rowCount: 1338, gapCount: 1, duplicateCount: 0, coveragePct: 99.92531740104556,
  isDemo: false, source: "binance_csv_resampled_h1",
  datasetHash: "967d5504fb115d39c0b1a2e14c4fcff3285a03453605e48812cb56a381f2cafe",
};

/** Re-exported for convenience — literally the same object F21 froze, never recomputed here. */
export { FROZEN_RANGES };

export const MIN_SAMPLE_SIZE = 20;

const HOUR_MS = 3_600_000;
export const TIMEFRAME_BAR_MS: Record<"H4" | "D1", number> = { H4: 4 * HOUR_MS, D1: 24 * HOUR_MS };

/**
 * Corta `bars` (ya en un timeframe agregado, H4 o D1) a un rango de
 * calendario, exigiendo que la VENTANA COMPLETA de cada barra (no solo su
 * timestamp de apertura) quede contenida en el rango — nunca solo su
 * apertura. F21's `sliceBarsToRange` compara solo `timestamp` contra
 * [start,end], lo cual es correcto para H1 (apertura y cobertura
 * coinciden a la hora) pero NO para H4/D1: una barra D1 que abre a las
 * 00:00 pero cuya ventana llega hasta las 23:59 podría "aparentar" caer
 * dentro de IS por su apertura mientras una parte real de su información
 * (el close, el high/low de las últimas horas) pertenece cronológicamente
 * a VALIDATION — eso SÍ sería lookahead a nivel de contenido de la barra,
 * aunque no a nivel de su timestamp nominal. Esta función excluye
 * cualquier barra que cruce un límite de segmento — nunca la asigna al
 * lado "más conveniente", simplemente la descarta de los 3 segmentos y lo
 * dice (ver `describeSplit`).
 */
export function sliceAggregatedBarsToRange(bars: OHLCVBar[], range: { start: Date; end: Date }, timeframe: "H4" | "D1"): OHLCVBar[] {
  const barMs = TIMEFRAME_BAR_MS[timeframe];
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  return bars.filter((b) => {
    const openMs = b.timestamp.getTime();
    const closeMs = openMs + barMs - 1;
    return openMs >= startMs && closeMs <= endMs;
  });
}

export interface AggregatedSplitCounts {
  timeframe: TimeframeCode;
  isCount: number;
  validationCount: number;
  oosCount: number;
  droppedAtBoundaries: number;
}

/** Aplica `sliceAggregatedBarsToRange` a los 3 segmentos y reporta cuántas barras se descartaron por cruzar un límite — nunca silenciosamente. */
export function splitAggregatedBars(bars: OHLCVBar[], timeframe: "H4" | "D1"): { is: OHLCVBar[]; validation: OHLCVBar[]; oos: OHLCVBar[]; counts: AggregatedSplitCounts } {
  const is = sliceAggregatedBarsToRange(bars, FROZEN_RANGES.is, timeframe);
  const validation = sliceAggregatedBarsToRange(bars, FROZEN_RANGES.validation, timeframe);
  const oos = sliceAggregatedBarsToRange(bars, FROZEN_RANGES.oos, timeframe);
  const droppedAtBoundaries = bars.length - is.length - validation.length - oos.length;
  return { is, validation, oos, counts: { timeframe, isCount: is.length, validationCount: validation.length, oosCount: oos.length, droppedAtBoundaries } };
}
