import type { StrategyHypothesis } from "../research/hypothesisRegistry";

/**
 * Multi-Estrategias Candidatas para Backtesting y Filtrado FTMO — registro
 * de diseño de las 3 familias, escrito ANTES de correr ningún backtest
 * (misma disciplina que `research/hypothesisRegistry.ts`, mismo tipo
 * `StrategyHypothesis` reutilizado — nunca redefinido). El objetivo
 * declarado de las 3 es idéntico: rentabilidad MODERADA y CONSTANTE
 * (2-5% mensual) con riesgo BAJO por operación y control de drawdown — no
 * el retorno más alto posible. Ninguna de las 3 se ha optimizado sobre
 * resultados de backtest; los parámetros son elecciones explícitas y
 * razonables, documentadas aquí, nunca ajustadas después de ver P&L.
 */
export const FTMO_HYPOTHESIS_REGISTRY: StrategyHypothesis[] = [
  {
    strategyId: "trend-breakout-ftmo-v1",
    strategyName: "Tendencia/Breakout FTMO (Candidata A)",
    family: "A — Tendencia + Ruptura filtrada",
    hypothesis:
      "Un breakout de rango (`breakoutBaseline.ts`) confirmado por un filtro de tendencia (SMA50) tiene menor tasa de falsos positivos que un breakout puro, porque descarta rupturas contra-tendencia — el modo de fallo más común de un breakout en mercados en rango. Un stop más ajustado (ATR×1.2 vs 1.5) y un RRR más modesto (1.3 vs 1.5) buscan operaciones más frecuentes y de riesgo más bajo, en vez de perseguir movimientos grandes y poco frecuentes.",
    expectedRegime: "STRONG_BULL/BULL (rupturas alcistas), BEAR/STRONG_BEAR (rupturas bajistas), TRANSITION.",
    expectedFailureRegime: "RANGE/NEUTRAL — el filtro de tendencia debería, por construcción, rechazar la mayoría de las rupturas en este régimen; si aun así dispara con frecuencia ahí, el filtro no está funcionando como se espera.",
    entryLogic:
      "1) Ventana de ruptura sobre las `lookback` velas ESTRICTAMENTE anteriores (nunca la vela actual). 2) SMA(`trendFilterPeriod`) sobre el cierre actual. 3) LONG solo si close > máximo de la ventana Y close > SMA(trendFilterPeriod). SHORT simétrico con el mínimo de la ventana y close < SMA(trendFilterPeriod). Una ruptura sin el filtro de tendencia alineado se descarta, nunca se relaja.",
    exitLogic: "SL/TP fijos calculados en la entrada — misma convención que el resto de estrategias de este repositorio.",
    slLogic: "stopDistance = ATR(volatilityPeriod) × atrMultiplier de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { lookback: 20, trendFilterPeriod: 50, volatilityPeriod: 14, atrMultiplier: 1.2, rrr: 1.3 },
    parameterJustification:
      "lookback=20 y volatilityPeriod=14 son los mismos que Breakout Baseline (Fase 11), para que la única diferencia estructural sea el filtro de tendencia. trendFilterPeriod=50 reutiliza el mismo periodo que Trend Following Baseline (Fase 11), un valor ya establecido en este repositorio, no elegido por barrido. atrMultiplier=1.2 (más ajustado que el 1.5 del baseline) y rrr=1.3 (más modesto que 1.5) son una elección deliberada hacia operaciones de menor riesgo y objetivo más alcanzable — coherente con el objetivo de rentabilidad moderada y constante, no una optimización sobre resultados.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si el filtro de tendencia no reduce el ratio de operaciones perdedoras por reversión inmediata frente a Breakout Baseline (Fase 11) sobre el mismo dataset, o si el número de señales cae tanto que la muestra es demasiado pequeña para concluir nada (resultado INCONCLUSIVE, nunca confirmación).",
  },
  {
    strategyId: "mean-reversion-ftmo-v1",
    strategyName: "Reversión a la Media FTMO (Candidata B)",
    family: "B — Reversión a la Media con doble confirmación",
    hypothesis:
      "Exigir DOS confirmaciones independientes (precio en/fuera de una Banda de Bollinger Y RSI en zona extrema) antes de apostar por reversión reduce las señales marginales frente a usar una sola condición — estructuralmente distinto de `meanReversionBaseline.ts` (z-score puro sobre SMA, una sola condición). Un RRR modesto (1.2) refleja que el objetivo realista de una reversión es volver hacia la media, no un movimiento extendido.",
    expectedRegime: "RANGE, NEUTRAL, LOW_VOLATILITY.",
    expectedFailureRegime: "STRONG_BULL/STRONG_BEAR — el modo de fallo clásico de cualquier estrategia de reversión: el precio sigue extendiéndose en zona de sobrecompra/sobreventa en vez de revertir.",
    entryLogic:
      "1) Bandas de Bollinger (`period`, `stdDevMultiplier` desviaciones típicas) sobre el cierre. 2) RSI(`rsiPeriod`) de la vela actual. 3) LONG solo si close <= banda inferior Y RSI <= `rsiOversold`. SHORT solo si close >= banda superior Y RSI >= `rsiOverbought`. Cualquiera de las dos condiciones sola (solo banda, o solo RSI) se descarta.",
    exitLogic: "SL/TP fijos calculados en la entrada.",
    slLogic: "stopDistance = ATR(volatilityPeriod) × atrMultiplier de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { period: 20, stdDevMultiplier: 2, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, volatilityPeriod: 14, atrMultiplier: 1, rrr: 1.2 },
    parameterJustification:
      "period=20/stdDevMultiplier=2 son los valores estándar de Bollinger Bands, idénticos a la convención de `bollingerBands()` del Feature Engine (bbUpper/bbLower ya calculados con estos mismos valores por defecto). rsiPeriod=14 es el periodo estándar ya usado en todo el repositorio. rsiOversold=30/rsiOverbought=70 son los umbrales RSI clásicos (no los 25/75 más estrictos de `research-momentum-reversal-v1`, deliberadamente, porque aquí la segunda confirmación ya viene de las Bandas de Bollinger, no de exigir un RSI más extremo). atrMultiplier=1 (el más ajustado de las 3 candidatas) y rrr=1.2 (el más modesto) reflejan que el objetivo de una reversión es un movimiento corto de vuelta a la media, no una extensión.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si la doble confirmación no muestra mejor win rate / average R que Mean Reversion Baseline (Fase 11, una sola condición vía z-score) sobre el mismo dataset — es decir, si exigir ambas condiciones a la vez no añade nada medible frente a exigir solo una.",
  },
  {
    strategyId: "ma-cross-momentum-ftmo-v1",
    strategyName: "Cruce de Medias con Momentum FTMO (Candidata C)",
    family: "C — Cruce de medias disparado por evento + confirmación de momentum",
    hypothesis:
      "Un cruce de medias detectado por EVENTO (la EMA rápida pasa de <= a > la EMA lenta EN esta vela) genera señales más selectivas y de mayor convicción que un cruce de medias por ESTADO (`trendFollowingBaseline.ts`, que dispara en cada vela donde fastMA != slowMA, sin importar cuánto tiempo lleve así) — menos operaciones, cada una respaldada por un cambio real de régimen de medias, no por la persistencia de un estado ya conocido. La confirmación de momentum (RSI respecto a su línea media) descarta cruces sin empuje real detrás.",
    expectedRegime: "STRONG_BULL/BULL (cruces alcistas), BEAR/STRONG_BEAR (cruces bajistas).",
    expectedFailureRegime: "RANGE/NEUTRAL, donde las medias oscilan y producen cruces frecuentes sin continuación real (whipsaw) — el filtro de momentum debería, por construcción, reducir estos falsos cruces.",
    entryLogic:
      "1) EMA(`fastPeriod`) y EMA(`slowPeriod`) sobre el cierre, comparadas entre la vela ANTERIOR y la vela ACTUAL (nunca solo el estado actual). 2) Cruce alcista = fastEMA_anterior <= slowEMA_anterior Y fastEMA_actual > slowEMA_actual (evento, no estado). 3) RSI(`momentumPeriod`) de la vela actual debe estar por encima de `momentumThreshold` (alcista) o por debajo de 100−`momentumThreshold` (bajista). Solo dispara si el cruce fresco Y el momentum coinciden.",
    exitLogic: "SL/TP fijos calculados en la entrada.",
    slLogic: "stopDistance = ATR(volatilityPeriod) × atrMultiplier de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { fastPeriod: 10, slowPeriod: 30, momentumPeriod: 14, momentumThreshold: 50, volatilityPeriod: 14, atrMultiplier: 1.3, rrr: 1.4 },
    parameterJustification:
      "fastPeriod=10/slowPeriod=30 son periodos EMA más cortos y explícitos que los SMA 20/50 de Trend Following Baseline (deliberado: un cruce disparado por evento necesita medias más reactivas que un filtro de estado persistente, para no perderse cruces reales entre revisiones). momentumPeriod=14 reutiliza el periodo RSI estándar del repositorio. momentumThreshold=50 es la línea media natural del RSI (por encima/debajo de 50 = sesgo alcista/bajista), un umbral simple y explícito, no ajustado por resultado. atrMultiplier=1.3 y rrr=1.4 son valores intermedios entre las otras dos candidatas, reflejando que un cruce de medias confirmado por momentum es una señal de convicción media — ni tan ajustada como la reversión (B) ni tan amplia como el breakout con tendencia (A).",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si el filtro de momentum no reduce el ratio de cruces fallidos (SL alcanzado en pocas velas) frente a un cruce de medias SIN confirmación de momentum sobre el mismo dataset, o si el requisito de cruce fresco (evento) produce tan pocas señales que la muestra es demasiado pequeña para concluir nada (INCONCLUSIVE, nunca confirmación).",
  },
  {
    strategyId: "ma-cross-momentum-ftmo-v2",
    strategyName: "Cruce de Medias con Momentum FTMO v2 (Candidata C — Filtro ATR + TP Dinámico)",
    family: "C-v2 — Cruce de medias por evento + momentum + filtro de volatilidad mínima + TP dinámico",
    hypothesis:
      "Segunda iteración escrita a partir de la evidencia REAL de v1 (backtest sobre BTC/ETH H1, 2 ventanas de 12 meses, 4 corridas): v1 ya tenía la mejor disciplina de riesgo de las 3 candidatas (drawdown medio 5.8% frente a 33.5%/49.0% de A/B) pero sin edge neto positivo (retorno medio mensual −0.31%, Profit Factor medio 0.53, solo 48 operaciones en 4 años-activo — algunas ventanas con 1 sola operación). La hipótesis de v2 es que una parte de esas pérdidas viene de cruces disparados en rangos de volatilidad ANORMALMENTE BAJA (falsas rupturas de medias sin recorrido real), y que un TP fijo de RRR=1.4 corta ganadores fuertes antes de tiempo cuando el momentum de entrada era alto. v2 añade (a) un filtro de ATR mínimo relativo al propio historial reciente del activo en la vela de activación, y (b) un TP cuyo RRR escala con la intensidad del RSI de entrada (más momentum → objetivo más ambicioso) más un trailing stop que protege beneficio ya conseguido — el Stop Loss (ATR×atrMultiplier) NO cambia respecto a v1.",
    expectedRegime: "Igual que v1: STRONG_BULL/BULL (cruces alcistas), BEAR/STRONG_BEAR (cruces bajistas).",
    expectedFailureRegime: "Igual que v1 (RANGE/NEUTRAL, whipsaw) — el filtro ATR debería, además, reducir específicamente los cruces que sí pasan el gate de régimen pero ocurren en compresión de volatilidad dentro de un régimen nominalmente direccional.",
    entryLogic:
      "Idéntica a v1 (cruce EMA(fastPeriod/slowPeriod) por EVENTO + confirmación RSI(momentumPeriod) vs. momentumThreshold) MÁS una tercera condición obligatoria: ATR(volatilityPeriod) de la vela actual >= media de su propio ATR de las `atrFilterPeriod` velas ESTRICTAMENTE anteriores (ventana excluye la vela actual) × `atrFilterMultiplier`. Las tres condiciones (cruce fresco + momentum + volatilidad no anormalmente baja) deben cumplirse a la vez; ninguna se relaja si solo faltan una o dos.",
    exitLogic:
      "SL calculado en la entrada igual que v1 (no cambia). TP dinámico calculado en la entrada: RRR efectivo = baseRrr + min(1, intensidadMomentum) × momentumRrrBonus, donde intensidadMomentum es cuán lejos está el RSI de `momentumThreshold` (saturado en 1 en el extremo). Trailing stop (misma magnitud que el SL) activo en el motor de backtesting estático para proteger beneficio ya conseguido sin capar el trade al primer objetivo.",
    slLogic: "Sin cambios respecto a v1: stopDistance = ATR(volatilityPeriod) × atrMultiplier de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × (baseRrr + intensidadMomentum × momentumRrrBonus). Rango dinámico con los parámetros por defecto: RRR ∈ [1.4, 2.6].",
    initialParams: {
      fastPeriod: 10,
      slowPeriod: 30,
      momentumPeriod: 14,
      momentumThreshold: 50,
      volatilityPeriod: 14,
      atrMultiplier: 1.3,
      atrFilterPeriod: 20,
      atrFilterMultiplier: 1,
      baseRrr: 1.4,
      momentumRrrBonus: 1.2,
    },
    parameterJustification:
      "fastPeriod/slowPeriod/momentumPeriod/momentumThreshold/volatilityPeriod/atrMultiplier se HEREDAN sin cambios de v1 — no se re-calibran a partir de los resultados de v1, precisamente para aislar el efecto de las dos mejoras nuevas. atrFilterPeriod=20 es una ventana de calibración de volatilidad habitual en este repositorio (mismo orden que `period` de Bollinger en la Candidata B). atrFilterMultiplier=1 es la elección más simple y neutral posible: exigir que la volatilidad actual sea al menos la media reciente, ni más laxo ni más estricto — un valor >1 habría sido un ajuste discrecional sin base estructural. baseRrr=1.4 es idéntico al RRR fijo de v1 (el caso de menor momentum de v2 se reduce exactamente a v1); momentumRrrBonus=1.2 fue elegido para que el techo dinámico (2.6) coincida con el punto medio ya usado como aproximación estática (`defaultTakeProfitPct`), no ajustado para maximizar ningún resultado.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si, sobre el mismo dataset y las mismas ventanas ya usadas para evaluar v1 (BTC/ETH H1, sep-2025→ago-2026 y sep-2024→ago-2025): (a) el número de operaciones de v2 no es estrictamente menor o igual al de v1 en cada corrida (el filtro ATR debe ser un filtro adicional, nunca ampliar el universo de señales), y (b) el Profit Factor y el retorno mensual medio de v2 no mejoran frente a v1 en al menos 3 de las 4 corridas. Si el drawdown medio de v2 empeora frente a v1 pese al trailing stop, la hipótesis también queda rechazada — v2 nunca debe sacrificar la disciplina de riesgo que era la principal fortaleza de v1.",
  },
  {
    strategyId: "ma-cross-momentum-ftmo-v2-1",
    strategyName: "Cruce de Medias con Momentum FTMO v2.1 (Candidata C — Filtro ATR 0.75x + TP Dinámico)",
    family: "C-v2.1 — Cruce de medias por evento + momentum + filtro de volatilidad mínima RELAJADO (0.75x) + TP dinámico",
    hypothesis:
      "Tercera iteración escrita a partir de la evidencia REAL de v2 (backtest sobre BTC/ETH H1, mismas 2 ventanas de 12 meses, 4 corridas, auditoría de señales bruta vs. filtrada): el filtro ATR de v2 (umbral 1.0x, exigir que el ATR actual sea al menos el 100% de su media reciente) descartó el 75% de las señales brutas de cruce+momentum (38 de 51), incluida la ÚNICA señal del año en BTC-alcista (0 operaciones esa ventana) — un sobre-filtrado que dejó una muestra de solo 13 operaciones en 4 activos-año, insuficiente para demostrar edge de forma robusta pese a que la ventana ETH-alcista sí mostró un resultado genuinamente positivo (PF 1.53). La hipótesis de v2.1 es que bajar el umbral a 0.75x permite capturar entradas cuando la volatilidad ya está REPUNTANDO desde un mínimo reciente pero aún no ha vuelto por completo a su media — el inicio real de un movimiento institucional, no solo su confirmación tardía — sin dejar de rechazar los rangos genuinamente muertos (volatilidad muy por debajo de lo normal). Ningún otro parámetro cambia respecto a v2.",
    expectedRegime: "Igual que v1/v2: STRONG_BULL/BULL (cruces alcistas), BEAR/STRONG_BEAR (cruces bajistas).",
    expectedFailureRegime: "Igual que v2 (RANGE/NEUTRAL, whipsaw) — un umbral más laxo (0.75x) podría, por construcción, dejar pasar más falsos cruces en compresión de volatilidad que v2 (1.0x); esto se mide directamente comparando el número de operaciones y el Profit Factor de v2.1 frente a v2, no se asume.",
    entryLogic:
      "Idéntica a v2 en todo: cruce EMA(fastPeriod/slowPeriod) por EVENTO + confirmación RSI(momentumPeriod) vs. momentumThreshold + ATR(volatilityPeriod) de la vela actual >= media de su propio ATR de las `atrFilterPeriod` velas ESTRICTAMENTE anteriores × `atrFilterMultiplier`. Único cambio: atrFilterMultiplier baja de 1 a 0.75.",
    exitLogic: "Idéntica a v2, sin cambios: SL/TP dinámico/trailing stop calculados exactamente igual.",
    slLogic: "Sin cambios respecto a v1/v2: stopDistance = ATR(volatilityPeriod) × atrMultiplier de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "Sin cambios respecto a v2: TP = close ± stopDistance × (baseRrr + intensidadMomentum × momentumRrrBonus). Rango dinámico [1.4, 2.6].",
    initialParams: {
      fastPeriod: 10,
      slowPeriod: 30,
      momentumPeriod: 14,
      momentumThreshold: 50,
      volatilityPeriod: 14,
      atrMultiplier: 1.3,
      atrFilterPeriod: 20,
      atrFilterMultiplier: 0.75,
      baseRrr: 1.4,
      momentumRrrBonus: 1.2,
    },
    parameterJustification:
      "Todos los parámetros se HEREDAN sin cambios de v2 excepto uno: atrFilterMultiplier baja de 1 a 0.75, un valor redondo (75% de la media reciente) elegido por ser la relajación explícita solicitada — no calibrado buscando maximizar ningún resultado del propio backtest de v2.1 (que no se había ejecutado todavía al fijar este valor). No se toca ningún otro parámetro precisamente para aislar el efecto de esta única relajación frente a v2.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si, sobre el mismo dataset y las mismas 4 corridas ya usadas para evaluar v1 y v2 (BTC/ETH H1, sep-2025→ago-2026 y sep-2024→ago-2025): (a) el número de operaciones de v2.1 no aumenta frente a v2 en ninguna corrida (si el umbral relajado no deja pasar ninguna señal adicional, la relajación no tuvo efecto medible), o (b) el Profit Factor y/o el retorno mensual medio de v2.1 empeoran frente a v2 en al menos 3 de las 4 corridas (señal de que las operaciones adicionales capturadas eran precisamente las de peor calidad que v2 descartaba con razón). Si el drawdown medio de v2.1 supera el de v1 (5.84%) — no solo el de v2 (1.67%) — la hipótesis también queda rechazada: relajar el filtro nunca debe devolver la disciplina de riesgo al nivel, o peor, que el de la estrategia original sin filtro.",
  },
];

export function getFtmoHypothesis(strategyId: string): StrategyHypothesis | undefined {
  return FTMO_HYPOTHESIS_REGISTRY.find((h) => h.strategyId === strategyId);
}
