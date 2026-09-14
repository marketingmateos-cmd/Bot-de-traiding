import { computeIsValidationOosRanges, type IsValidationOosRangesWithLabels } from "./hypothesisValidation";

/**
 * Fase 21 — Data Expansion + Research Kickoff (BTC + ETH, ~3.5 años H1).
 * Congelación total ANTES de que ningún módulo de Discovery lea un bar de
 * VALIDATION/OOS: dataset identity (con datasetHash real, verificado tras
 * la importación), partición IS/VALIDATION/OOS, y todos los parámetros de
 * las 6 familias de hipótesis (A-F) del brief. Nada de este archivo se
 * modifica después de observar resultados de Discovery/Validation/OOS.
 *
 * IMPORTANTE — este dataset es ADICIONAL, no un reemplazo: el benchmark
 * BTCUSDT H1 de 6 meses (2026-03-01→2026-08-31, hash
 * 8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503) usado
 * en Fase 11-20 sigue existiendo como su propia fila `ResearchDataset`
 * completamente separada — nunca se toca, nunca se recalcula, nunca se
 * sustituye por este rango más amplio.
 */

export const FROZEN_DATASET_BTC = {
  symbol: "BTC",
  timeframe: "H1" as const,
  startDate: new Date("2023-01-01T00:00:00.000Z"),
  endDate: new Date("2026-08-31T23:00:00.000Z"),
  rowCount: 32135,
  gapCount: 1, // real: 2023-03-24T13:00:00Z falta en la fuente (documentado, nunca rellenado) — ver informe
  duplicateCount: 0,
  coveragePct: 99.99688822504356,
  isDemo: false,
  source: "binance_csv",
  datasetHash: "275eb78319cfe3a79487f8374dcacba3c9e1269ba26230a8381079f5fa1be870",
};

export const FROZEN_DATASET_ETH = {
  symbol: "ETH",
  timeframe: "H1" as const,
  startDate: new Date("2023-01-01T00:00:00.000Z"),
  endDate: new Date("2026-08-31T23:00:00.000Z"),
  rowCount: 32135,
  gapCount: 1, // mismo gap real que BTC (2023-03-24T13:00:00Z), documentado, nunca rellenado
  duplicateCount: 0,
  coveragePct: 99.99688822504356,
  isDemo: false,
  source: "binance_csv",
  datasetHash: "71d64cdc26d0bf856335da05116bc24862798466ee903fd14fd88e31627906f5",
};

/**
 * Misma partición 60/20/20 de Fase 13 (`computeIsValidationOosRanges`),
 * reutilizada sin redefinir — aplicada aquí al rango completo BTC/ETH
 * (idéntico para ambos activos, mismas fechas). Calculado UNA vez al cargar
 * el módulo, nunca recalculado tras ver ningún resultado.
 */
export const FROZEN_RANGES: IsValidationOosRangesWithLabels = (() => {
  const ranges = computeIsValidationOosRanges(FROZEN_DATASET_BTC.startDate, FROZEN_DATASET_BTC.endDate);
  if (!ranges) throw new Error("Fase 21: el rango congelado es demasiado corto para IS/VALIDATION/OOS — no debería ocurrir con ~3.5 años de datos.");
  return ranges;
})();

export const MIN_SAMPLE_SIZE = 20;

// ── Familia A — Autocorrelación / Persistencia ──────────────────────────
export const F21A_LAGS_HOURS = [1, 2, 3, 6, 12, 24] as const;
export const F21A_BOOTSTRAP_CONFIG = { iterations: 5000, seed: 21, blockSize: 24 };

// ── Familia B — Momentum / Reversión ────────────────────────────────────
/** Horizontes de retorno pasado Y de retorno futuro (simétricos — el mismo horizonte se usa para detectar el movimiento extremo y para medir qué pasa después, para no introducir un parámetro libre adicional). */
export const F21B_HORIZONS_HOURS = [1, 3, 6, 12, 24] as const;
/** "Extremo" = el retorno de ese horizonte está en el percentil <=10 o >=90 de su propia distribución histórica reciente — mismo estilo de umbral por percentil que F17-A/F20-E (squeezePercentile), nunca un z-score ad-hoc. */
export const F21B_EXTREME_PERCENTILE = 10;
/** Ventana histórica (en observaciones, no en horas) sobre la que se calcula ese percentil — ~3 semanas de barras H1, un valor redondo elegido antes de ver ningún resultado. */
export const F21B_PERCENTILE_LOOKBACK = 500;
export const F21B_BOOTSTRAP_CONFIG = { iterations: 5000, seed: 21, blockSize: 24 };

// ── Familia C — Volatilidad (compresión/expansión, transiciones) ────────
export const F21C_ATR_PERIOD = 14;
/** Mismo periodo que F17-A/F20-E — nunca re-elegido para esta familia. */
export const F21C_PERCENTILE_LOOKBACK = 500;
export const F21C_LOW_VOL_PERCENTILE = 20;
export const F21C_HIGH_VOL_PERCENTILE = 80;
export const F21C_FORWARD_HORIZONS_HOURS = [6, 12, 24] as const;
export const F21C_BOOTSTRAP_CONFIG = { iterations: 5000, seed: 21, blockSize: 24 };

// ── Familia D — Precio + Volumen ─────────────────────────────────────────
/** Mismos valores que Breakout Baseline (Fase 11): lookback=20 para el rango de ruptura. */
export const F21D_BREAKOUT_LOOKBACK = 20;
/** Mismo periodo/umbral que la familia B de Fase 17 (Volume Confirmation) — reutilizado, no re-elegido. */
export const F21D_VOLUME_ZSCORE_PERIOD = 20;
export const F21D_VOLUME_ZSCORE_THRESHOLD = 1.5;
/** Volumen "bajo" para la hipótesis de divergencia (F20-C): ratio < 0.7 de la media del lookback — mismo umbral que F20-C, reutilizado. */
export const F21D_LOW_VOLUME_RATIO = 0.7;
export const F21D_FORWARD_HORIZONS_HOURS = [6, 12, 24] as const;
export const F21D_BOOTSTRAP_CONFIG = { iterations: 5000, seed: 21, blockSize: 24 };
/**
 * IMPORTANTE (spec sección 10.D): el volumen de estos archivos es la
 * columna `volume` de un kline crudo de Binance — volumen BASE realmente
 * negociado en ese exchange durante esa hora, reportado directamente por
 * Binance, no un proxy sintético ni estimado. Documentado aquí explícita y
 * verificablemente porque el brief lo exige; ver el informe de Fase 21
 * para la verificación byte-a-byte de la columna.
 */
export const F21D_VOLUME_IS_REAL_EXCHANGE_VOLUME_NOT_A_PROXY = true;

// ── Familia E — Compresión → Expansión ("Coiling Length") ───────────────
/** IDÉNTICOS a F17-A/F20-E — reutilizados, nunca re-elegidos, para que cualquier comparación de novedad frente a esas familias sea limpia. */
export const F21E_ATR_PERIOD = 14;
export const F21E_SQUEEZE_LOOKBACK = 40;
export const F21E_SQUEEZE_PERCENTILE = 20;
export const F21E_MIN_COIL_LENGTH = 10;
export const F21E_FORWARD_HORIZONS_HOURS = [6, 12, 24] as const;
export const F21E_BOOTSTRAP_CONFIG = { iterations: 5000, seed: 21, blockSize: 24 };

// ── Familia F — Regímenes (cruce, no una familia independiente) ─────────
/** Cualquier celda régimen×señal con menos de MIN_SAMPLE_SIZE observaciones se marca INCONCLUSIVE — nunca se declara edge sobre una celda pequeña (spec sección 10.F). */
export const F21F_MIN_CELL_SAMPLE_SIZE = MIN_SAMPLE_SIZE;
