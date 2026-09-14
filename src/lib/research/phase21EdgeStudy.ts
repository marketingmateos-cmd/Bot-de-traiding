import { mulberry32 } from "@/lib/providers/market-data/seeded-random";

/**
 * Fase 21 — motor estadístico genérico reutilizado por las familias B
 * (momentum/reversión), C (volatilidad), D (precio+volumen) y E
 * (compresión→expansión): "dado que la condición C se cumplió en el bar t
 * (calculada causalmente con datos hasta t), ¿qué retorno se observó desde
 * t hasta t+horizonte?" — la misma pregunta subyacente en las 4 familias,
 * solo cambia cómo se define C.
 *
 * Nota sobre causalidad: `computeForwardReturns` mira DELIBERADAMENTE hacia
 * delante — esto es correcto y necesario para un estudio de Discovery
 * puramente estadístico (etiquetar qué pasó después de un evento ya
 * ocurrido en el pasado, dentro del segmento IS ya congelado), NUNCA para
 * tomar una decisión de entrada en vivo. Si una familia se formaliza más
 * adelante como `StrategyDefinition` (como hizo F20-E), esa estrategia
 * debe decidir su entrada usando solo `barsAsOf` hasta t, exactamente
 * igual que las demás — este módulo nunca se usa directamente dentro de
 * un `evaluate()` de estrategia.
 */

/** retorno desde t hasta t+horizonte; null si t+horizonte está fuera de rango o el precio base no es positivo. */
export function computeForwardReturns(closes: number[], horizon: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let t = 0; t < closes.length - horizon; t++) {
    const base = closes[t];
    const future = closes[t + horizon];
    if (base <= 0 || future <= 0) continue;
    out[t] = (future - base) / base;
  }
  return out;
}

/** retorno realizado ENTRE t-horizonte y t (causal: solo usa precios hasta t inclusive). */
export function computeTrailingReturns(closes: number[], horizon: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let t = horizon; t < closes.length; t++) {
    const base = closes[t - horizon];
    const current = closes[t];
    if (base <= 0 || current <= 0) continue;
    out[t] = (current - base) / base;
  }
  return out;
}

/**
 * Percentil (0-100) del valor en `index` respecto a los `lookback` valores
 * ESTRICTAMENTE anteriores de la misma serie (nunca incluye `index` — mismo
 * convenio causal que `computeAtrPercentileRanks` de F20-E/F17-A).
 */
export function computeTrailingPercentileRank(values: (number | null)[], index: number, lookback: number): number | null {
  const current = values[index];
  if (current === null) return null;
  const history = values.slice(Math.max(0, index - lookback), index).filter((v): v is number => v !== null);
  if (history.length < lookback * 0.5) return null; // exige al menos la mitad de la ventana con datos reales
  return (history.filter((v) => v <= current).length / history.length) * 100;
}

/** Volatilidad realizada (desviación típica de log-retornos horarios) en la ventana [t, t+horizonte) — null si esa ventana no cabe entera en la serie. */
export function computeForwardRealizedVol(closes: number[], t: number, horizon: number): number | null {
  if (t + horizon >= closes.length) return null;
  const rets: number[] = [];
  for (let i = t; i < t + horizon; i++) {
    if (closes[i] <= 0 || closes[i + 1] <= 0) return null;
    rets.push(Math.log(closes[i + 1] / closes[i]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((sum, v) => sum + (v - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

export interface ConditionalReturnStats {
  n: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  winRate: number | null; // fracción con forwardReturn > 0
}

function median(sortedValues: number[]): number | null {
  if (sortedValues.length === 0) return null;
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 1 ? sortedValues[mid] : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

export function computeConditionalStats(forwardReturns: number[]): ConditionalReturnStats {
  const n = forwardReturns.length;
  if (n === 0) return { n: 0, mean: null, median: null, std: null, winRate: null };
  const mean = forwardReturns.reduce((a, b) => a + b, 0) / n;
  const variance = forwardReturns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const sorted = [...forwardReturns].sort((a, b) => a - b);
  return {
    n,
    mean,
    median: median(sorted),
    std: Math.sqrt(variance),
    winRate: forwardReturns.filter((v) => v > 0).length / n,
  };
}

export interface BlockBootstrapCI {
  observed: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  bootstrapSamples: number;
}

/**
 * Bootstrap por bloques (no i.i.d.) de una estadística arbitraria sobre una
 * serie — los retornos hacia delante de horizontes solapados están
 * autocorrelacionados, así que un bootstrap i.i.d. subestimaría la
 * varianza; el bootstrap por bloques preserva esa dependencia de corto
 * plazo dentro de cada bloque, mismo enfoque que F20-A.
 */
export function blockBootstrapCI(values: number[], statFn: (sample: number[]) => number | null, options: { iterations: number; seed: number; blockSize: number }): BlockBootstrapCI {
  const observed = statFn(values);
  const n = values.length;
  if (observed === null || n < options.blockSize * 2) {
    return { observed, ciLow: null, ciHigh: null, bootstrapSamples: 0 };
  }

  const rand = mulberry32(options.seed);
  const blockSize = Math.max(1, options.blockSize);
  const numBlocks = Math.ceil(n / blockSize);
  const samples: number[] = [];

  for (let iter = 0; iter < options.iterations; iter++) {
    const resampled: number[] = [];
    for (let b = 0; b < numBlocks; b++) {
      const startIdx = Math.floor(rand() * (n - blockSize + 1));
      for (let j = 0; j < blockSize && resampled.length < n; j++) {
        resampled.push(values[startIdx + j]);
      }
    }
    const stat = statFn(resampled);
    if (stat !== null) samples.push(stat);
  }

  if (samples.length === 0) {
    return { observed, ciLow: null, ciHigh: null, bootstrapSamples: 0 };
  }
  samples.sort((a, b) => a - b);
  const lowIdx = Math.floor(0.025 * (samples.length - 1));
  const highIdx = Math.floor(0.975 * (samples.length - 1));
  return { observed, ciLow: samples[lowIdx], ciHigh: samples[highIdx], bootstrapSamples: samples.length };
}

function meanOf(sample: number[]): number | null {
  if (sample.length === 0) return null;
  return sample.reduce((a, b) => a + b, 0) / sample.length;
}

/** Conveniencia: bootstrap por bloques específicamente de la MEDIA de una lista de retornos hacia delante. */
export function bootstrapMeanCI(forwardReturns: number[], options: { iterations: number; seed: number; blockSize: number }): BlockBootstrapCI {
  return blockBootstrapCI(forwardReturns, meanOf, options);
}

export type SignalEvidence = "SIGNIFICANT_CONTINUATION" | "SIGNIFICANT_REVERSAL" | "NO_SIGNAL" | "INSUFFICIENT_SAMPLE";

/**
 * Clasificación única, fija, aplicada mecánicamente (spec: "no declarar
 * edge por intuición"): el IC de bootstrap del retorno medio hacia delante
 * de un bucket, comparado contra CERO (hipótesis nula de deriva nula).
 * `expectedContinuationSign` es +1 para un bucket "extremo alcista" (si el
 * retorno futuro sigue siendo positivo, eso es CONTINUATION; si es
 * negativo, es REVERSAL) y -1 para un bucket "extremo bajista" (simétrico).
 */
export function classifySignalEvidence(stats: ConditionalReturnStats, ci: BlockBootstrapCI, expectedContinuationSign: 1 | -1, minSampleSize: number): SignalEvidence {
  if (stats.n < minSampleSize || ci.ciLow === null || ci.ciHigh === null) return "INSUFFICIENT_SAMPLE";
  const ciExcludesZero = ci.ciLow > 0 || ci.ciHigh < 0;
  if (!ciExcludesZero) return "NO_SIGNAL";
  const observedSign = ci.ciLow > 0 ? 1 : -1;
  return observedSign === expectedContinuationSign ? "SIGNIFICANT_CONTINUATION" : "SIGNIFICANT_REVERSAL";
}
