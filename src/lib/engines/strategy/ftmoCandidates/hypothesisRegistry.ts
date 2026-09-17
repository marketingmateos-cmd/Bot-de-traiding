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
];

export function getFtmoHypothesis(strategyId: string): StrategyHypothesis | undefined {
  return FTMO_HYPOTHESIS_REGISTRY.find((h) => h.strategyId === strategyId);
}
