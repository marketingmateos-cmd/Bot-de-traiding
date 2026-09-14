/**
 * Fase 21 — Data Expansion + Research Kickoff, registro de hipótesis.
 * Escrito ANTES de ejecutar un solo cálculo de Discovery sobre los datos
 * IS reales de BTC/ETH (en el momento de escribir este archivo, el
 * repositorio solo contiene datos OHLCV crudos importados y validados —
 * ningún resultado estadístico de ninguna familia ha sido observado
 * todavía). Cada hipótesis queda fijada aquí: fórmula, variables, ventana,
 * umbral y dirección, exactamente como se implementan en
 * `phase21EdgeStudy.ts` + `phase21PreRegistration.ts` — nada de esto se
 * modifica después de observar resultados de Discovery/Validation/OOS.
 */

export interface Phase21Hypothesis {
  id: string;
  nombre: string;
  motivacion: string;
  formula: string;
  variables: string;
  ventana: string;
  umbral: string;
  direccion: string;
  hipotesisEconomicaEstadistica: string;
  quePredice: string;
  comoSeMide: string;
  mecanismosDeFallo: string;
}

export const PHASE21_HYPOTHESIS_REGISTRY: Phase21Hypothesis[] = [
  {
    id: "F21-A",
    nombre: "Autocorrelación / Persistencia de retornos",
    motivacion:
      "Si los retornos horarios de BTC/ETH tuvieran dependencia serial genuina (no solo ruido), el retorno pasado contendría información sobre el retorno futuro. Fase 20 ya investigó esto sobre 6 meses de BTC sin encontrar nada — esta familia repite el mismo test con ~3.5 años y ambos activos, para ver si la ausencia de señal era un artefacto de muestra pequeña o un resultado genuino y estable.",
    formula: "ρ(k) = Σ_{t=1}^{n-k}(r_t-μ)(r_{t+k}-μ) / Σ_{t=1}^{n}(r_t-μ)² sobre log-retornos r_t = ln(close_t/close_{t-1}).",
    variables: "log-retorno horario de cierre a cierre, por activo (BTC, ETH) por separado.",
    ventana: "Toda la serie IS (por activo), IC 95% por bootstrap de bloques (blockSize=24h).",
    umbral: "Significativo si el IC 95% de ρ(k) excluye 0.",
    direccion: "No direccional — estudio estadístico puro (spec Condición equivalente a F20-A: nunca se convierte automáticamente en estrategia).",
    hipotesisEconomicaEstadistica:
      "H0: los retornos horarios son independientes entre sí (mercado eficiente a esa frecuencia). H1: existe dependencia serial medible en al menos uno de los 6 lags evaluados.",
    quePredice: "Si ρ(k) es significativo y estable en signo entre IS/VALIDATION/OOS y entre BTC/ETH, sugiere que el retorno de hace k horas tiene poder predictivo sobre el retorno actual.",
    comoSeMide: "computeAutocorrelation/computeAutocorrelationWithBootstrapCI (reutilizado de F20, mismo módulo engines/edgeSignals/autocorrelation.ts) sobre lags [1,2,3,6,12,24], por activo, por segmento.",
    mecanismosDeFallo: "Ruido de muestra finita; régimen de mercado cambiante que invierte el signo de ρ(k) entre periodos; efecto puramente mecánico de la estructura de fees/spread a esa frecuencia (no observable en klines OHLCV agregados).",
  },
  {
    id: "F21-B",
    nombre: "Momentum / Reversión tras movimientos extremos",
    motivacion:
      "Un movimiento de precio inusualmente grande en una ventana reciente (top/bottom decil de su propia distribución histórica) podría preceder continuación (momentum) o reversión (mean-reversion) — ambas son hipótesis económicas razonables y mutuamente excluyentes; el objetivo es determinar cuál, si alguna, describe mejor el comportamiento post-evento.",
    formula:
      "retornoPasado_h(t) = (close_t - close_{t-h}) / close_{t-h}. percentil_h(t) = rango percentil de retornoPasado_h(t) entre los F21B_PERCENTILE_LOOKBACK valores estrictamente anteriores de la misma serie. 'Extremo alcista' si percentil_h(t) >= 100-F21B_EXTREME_PERCENTILE; 'extremo bajista' si percentil_h(t) <= F21B_EXTREME_PERCENTILE. retornoFuturo_h(t) = (close_{t+h} - close_t) / close_t.",
    variables: "close horario, por activo, para horizontes h ∈ {1,3,6,12,24} horas (mismo horizonte para el movimiento pasado y el retorno futuro medido — sin parámetro libre adicional).",
    ventana: "Percentil calculado sobre F21B_PERCENTILE_LOOKBACK=500 observaciones estrictamente anteriores.",
    umbral: "F21B_EXTREME_PERCENTILE=10 (decil superior/inferior) — fijo, nunca ajustado por horizonte ni por activo.",
    direccion: "Bucket 'extremo alcista': continuación = signo esperado +1. Bucket 'extremo bajista': continuación = signo esperado -1.",
    hipotesisEconomicaEstadistica:
      "H0: tras un movimiento extremo, el retorno futuro esperado es 0 (deriva nula, igual que en cualquier otro momento). H1 (momentum): el retorno futuro tiene el MISMO signo que el movimiento extremo. H1 (reversión): el retorno futuro tiene signo OPUESTO.",
    quePredice: "El signo y magnitud del retorno de los próximos h horas, condicionado a haber observado un movimiento extremo de esas mismas h horas.",
    comoSeMide: "classifySignalEvidence sobre el IC de bootstrap por bloques (blockSize=24h) de la media de retornoFuturo_h dentro de cada bucket, comparado contra 0 — nunca contra un baseline elegido a posteriori.",
    mecanismosDeFallo: "Autocorrelación entre observaciones solapadas infla artificialmente la muestra efectiva (mitigado por bootstrap de bloques, no elimina el problema del todo); régimen de volatilidad cambiante altera qué cuenta como 'extremo' en distintos periodos históricos de forma no estacionaria.",
  },
  {
    id: "F21-C",
    nombre: "Estructura de volatilidad (compresión/expansión, transiciones)",
    motivacion:
      "La volatilidad realizada tiende a agruparse (clustering) — la pregunta es si el ESTADO actual de volatilidad (bajo/alto percentil de ATR reciente) contiene información sobre el retorno o la volatilidad futura, más allá de la mera persistencia ya conocida de la volatilidad en sí.",
    formula: "ATR(F21C_ATR_PERIOD) percentil-rank sobre F21C_PERCENTILE_LOOKBACK observaciones anteriores (misma función que compression.ts). Estado LOW_VOL si percentil <= F21C_LOW_VOL_PERCENTILE; HIGH_VOL si percentil >= F21C_HIGH_VOL_PERCENTILE.",
    variables: "ATR de 14 periodos (misma convención que F11/F17/F20), por activo.",
    ventana: "F21C_PERCENTILE_LOOKBACK=500 observaciones.",
    umbral: "F21C_LOW_VOL_PERCENTILE=20 / F21C_HIGH_VOL_PERCENTILE=80.",
    direccion: "No direccional en el retorno — se mide tanto retorno futuro como volatilidad futura realizada, condicionados al estado.",
    hipotesisEconomicaEstadistica: "H0: el estado de volatilidad actual no predice ni el signo/magnitud del retorno futuro ni el nivel de volatilidad futura, más allá de lo ya conocido por persistencia. H1: sí lo hace.",
    quePredice: "Retorno futuro (horizontes 6/12/24h) y volatilidad realizada futura, condicionados a LOW_VOL vs HIGH_VOL en t.",
    comoSeMide: "computeConditionalStats + bootstrapMeanCI sobre retornoFuturo condicionado a cada estado, comparado contra 0; volatilidad futura medida como std de retornos en la ventana futura.",
    mecanismosDeFallo: "El propio ATR ya es una medida de volatilidad — cualquier 'predicción' de volatilidad futura tiene alto riesgo de ser trivial/tautológica si no se compara adecuadamente contra la persistencia base ya esperada de cualquier proceso GARCH-like.",
  },
  {
    id: "F21-D",
    nombre: "Precio + Volumen (ruptura confirmada/divergente)",
    motivacion:
      "Una ruptura de rango (nuevo máximo/mínimo de F21D_BREAKOUT_LOOKBACK velas) acompañada de volumen alto podría tener más continuación que una sin confirmación de volumen; simétricamente, una ruptura con volumen bajo podría señalar una divergencia y mayor probabilidad de reversión — dos hipótesis distintas evaluadas por separado.",
    formula:
      "volumeZ(t) = z-score del volumen de la vela t sobre F21D_VOLUME_ZSCORE_PERIOD velas previas. Ruptura alcista: close_t > max(high de las F21D_BREAKOUT_LOOKBACK velas anteriores). 'Confirmada' si volumeZ(t) >= F21D_VOLUME_ZSCORE_THRESHOLD; 'divergente' si volumen_t / mediaVolumen(lookback) < F21D_LOW_VOLUME_RATIO.",
    variables: "close/high/low y volumen (REAL, reportado por Binance — ver F21D_VOLUME_IS_REAL_EXCHANGE_VOLUME_NOT_A_PROXY), por activo.",
    ventana: "F21D_BREAKOUT_LOOKBACK=20 velas (rango de ruptura); F21D_VOLUME_ZSCORE_PERIOD=20 velas (línea base de volumen).",
    umbral: "F21D_VOLUME_ZSCORE_THRESHOLD=1.5σ (confirmación); F21D_LOW_VOLUME_RATIO=0.7 (divergencia).",
    direccion: "Ruptura alcista confirmada/divergente: continuación esperada = +1. Ruptura bajista: continuación esperada = -1.",
    hipotesisEconomicaEstadistica: "H0: el volumen en el momento de la ruptura no aporta información sobre el retorno futuro más allá de la propia ruptura de precio. H1a (confirmación): alto volumen -> más continuación. H1b (divergencia): bajo volumen -> más reversión.",
    quePredice: "Retorno futuro (horizontes 6/12/24h) tras una ruptura, condicionado a volumen alto vs bajo en la vela de ruptura.",
    comoSeMide: "Igual mecánica que F21-B: classifySignalEvidence sobre el IC de bootstrap de la media de retornoFuturo en cada bucket (confirmada/divergente) frente a 0.",
    mecanismosDeFallo: "El volumen de Binance es reportado de forma fiable, pero puede incluir actividad de wash-trading/market-making no representativa de convicción direccional real — riesgo documentado, no verificable desde el propio dataset OHLCV.",
  },
  {
    id: "F21-E",
    nombre: "Compresión → Expansión (Coiling Length)",
    motivacion:
      "Repite la hipótesis ya investigada en F20-E (duración de la compresión de volatilidad antes de una ruptura) pero ahora con ~3.5 años y ambos activos, para ver si el resultado NEGATIVE de F20-E se sostiene con mucha más muestra o si era un artefacto del periodo de 6 meses evaluado.",
    formula: "Igual que F20-E: coilLength(t) = nº de velas consecutivas hasta t-1 con percentil de ATR <= F21E_SQUEEZE_PERCENTILE. Ruptura: expansión real de rango sobre el ATR actual, igual convención que F17-A/F20-E.",
    variables: "ATR(14), rango de la vela actual, por activo.",
    ventana: "F21E_SQUEEZE_LOOKBACK=40 (idéntico a F17-A/F20-E, nunca re-elegido).",
    umbral: "F21E_SQUEEZE_PERCENTILE=20, F21E_MIN_COIL_LENGTH=10 (idénticos a F20-E).",
    direccion: "Retorno futuro en la dirección de la ruptura (alcista tras ruptura al alza, bajista tras ruptura a la baja) = continuación esperada.",
    hipotesisEconomicaEstadistica: "H0: la duración de la compresión no predice la magnitud/dirección del retorno tras la ruptura, más allá de lo ya capturado por la propia ruptura. H1: coilLength más largo -> mayor magnitud de continuación.",
    quePredice: "Magnitud y signo del retorno futuro (6/12/24h) tras una ruptura, en función de coilLength.",
    comoSeMide: "Igual mecánica que F21-B/D. Adicionalmente: comparación de novedad frente a F21-C (mismo insumo ATR-percentil) y frente a F17-A/F20-E, vía correlación de señales (reutilizando `compareHypothesisToStrategy`-style de F20 si esta familia se formaliza como estrategia más adelante).",
    mecanismosDeFallo: "Redundancia estructural con F21-C (ambas usan percentil de ATR) — cualquier señal encontrada aquí debe distinguirse explícitamente de un simple efecto de 'estado de baja volatilidad' ya capturado por F21-C, no solo de duración.",
  },
  {
    id: "F21-F",
    nombre: "Regímenes (cruce transversal, no una familia independiente)",
    motivacion:
      "Cualquier señal encontrada en A-E podría ser en realidad un efecto de régimen de mercado (solo funciona en BULL, o solo en HIGH_VOLATILITY) en lugar de un efecto genuino y general — esta 'familia' no añade una hipótesis nueva, sino que estratifica los resultados de A-E por el Regime Engine ya existente (`detectRegime`, sin modificar) para detectar esa dependencia.",
    formula: "Reutiliza detectRegime(bars) sin modificar — clasifica cada observación de las familias A-E por su régimen en el momento t.",
    variables: "Régimen de mercado (STRONG_BULL/BULL/NEUTRAL/BEAR/STRONG_BEAR/HIGH_VOLATILITY/LOW_VOLATILITY/RANGE/TRANSITION) en t.",
    ventana: "N/A — clasificación puntual por bar, reutilizando la ventana ya interna de detectRegime (60 bars).",
    umbral: "F21F_MIN_CELL_SAMPLE_SIZE=20 — ninguna celda régimen×señal con menos de 20 observaciones se usa para declarar evidencia.",
    direccion: "Hereda la dirección de la familia A-E que se esté estratificando.",
    hipotesisEconomicaEstadistica: "H0: el efecto (si existe) es estable entre regímenes. H1: el efecto depende del régimen — solo aparece o se invierte en un subconjunto de regímenes.",
    quePredice: "Si una señal de A-E es consistente o dependiente de régimen.",
    comoSeMide: "Tabla de contingencia régimen×bucket con n, media, IC por celda; celdas con n<20 se marcan INCONCLUSIVE explícitamente, nunca se ocultan ni se rellenan.",
    mecanismosDeFallo: "Multiplicidad de comparaciones (9 regímenes × varias familias) — alto riesgo de falsos positivos por azar; exige un estándar de evidencia más estricto que las familias A-E individuales, nunca se declara edge de régimen con una sola celda positiva aislada.",
  },
];

export function getPhase21Hypothesis(id: string): Phase21Hypothesis | undefined {
  return PHASE21_HYPOTHESIS_REGISTRY.find((h) => h.id === id);
}
