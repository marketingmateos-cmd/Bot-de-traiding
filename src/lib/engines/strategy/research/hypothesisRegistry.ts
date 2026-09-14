/**
 * Fase 17 — Signal Research Lab, spec section 7 (Pre-Registration de
 * Hipótesis). This file is the single source of truth for what each new
 * research strategy is claiming, BEFORE any benchmark was run against it —
 * the initial parameters below are exactly what each strategy file in this
 * directory implements, chosen for being simple/explicit/reasonable, never
 * fitted to this dataset's outcome. Nothing in this file may be edited after
 * looking at benchmark results (spec: "no modificar la hipótesis después de
 * observar el P&L") — a later phase that wants to revise a hypothesis must
 * do so as a new, separately-versioned entry, never a silent edit here.
 */
export interface StrategyHypothesis {
  strategyId: string;
  strategyName: string;
  family: string;
  hypothesis: string;
  expectedRegime: string;
  expectedFailureRegime: string;
  entryLogic: string;
  exitLogic: string;
  slLogic: string;
  tpLogic: string;
  initialParams: Record<string, number>;
  parameterJustification: string;
  falsificationCriteria: string;
}

export const HYPOTHESIS_REGISTRY: StrategyHypothesis[] = [
  {
    strategyId: "research-volatility-squeeze-v1",
    strategyName: "Volatility Squeeze Breakout (Fase 17)",
    family: "A — Volatility Expansion / Contraction",
    hypothesis:
      "Un periodo de compresión de volatilidad (ATR reciente en la parte baja de su propia distribución histórica) puede preceder a una expansión direccional; una ruptura del rango comprimido con expansión real de ATR puede tener más continuidad que una ruptura sin compresión previa.",
    expectedRegime: "LOW_VOLATILITY en transición hacia HIGH_VOLATILITY; TRANSITION.",
    expectedFailureRegime: "RANGE persistente sin resolución direccional real (rupturas falsas repetidas de un rango que nunca se comprimió de verdad); tendencias fuertes y sostenidas donde el ATR rara vez se comprime.",
    entryLogic:
      "1) Se calcula el ATR(atrPeriod) de la vela ANTERIOR a la actual y se compara contra su propia distribución en las squeezeLookback velas previas (percentil). Si ese percentil <= squeezePercentile, hay 'squeeze'. 2) Se define el rango de compresión (high/low) sobre las rangeLookback velas estrictamente anteriores a la actual. 3) La vela actual dispara LONG si su close rompe por encima del high del rango Y su propio rango (high-low) supera expansionMultiplier × ATR actual (expansión real, no un cruce mínimo). Simétrico para SHORT.",
    exitLogic: "Igual convención que el resto de baselines: SL/TP fijos calculados en la entrada; sin lógica de salida adicional basada en señal.",
    slLogic: "stopDistance = ATR(atrPeriod) de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { atrPeriod: 14, squeezeLookback: 40, squeezePercentile: 20, rangeLookback: 10, expansionMultiplier: 1.3, rrr: 1.5 },
    parameterJustification:
      "atrPeriod=14 es el periodo estándar ya usado por las 4 estrategias baseline de Fase 11 (ningún ajuste especial). squeezeLookback=40 y squeezePercentile=20 son una ventana/umbral simples y explícitos ('el ATR está en el 20% más bajo de las últimas 40 lecturas'), no un valor buscado por barrido. rangeLookback=10 es la mitad de squeezeLookback, un valor redondo razonable para definir un rango de ruptura reciente. expansionMultiplier=1.3 exige una expansión real (30% por encima del ATR actual) para distinguir una ruptura genuina de un simple roce del rango. rrr=1.5 es idéntico al de Breakout/Momentum/MeanReversion baseline (Fase 11), para no introducir una ventaja de ejecución artificial.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si el average R y el win rate de estas operaciones no son distinguibles (o son peores) que los de Breakout Baseline (Fase 11) sobre el mismo dataset, o si la mayoría de las rupturas tras squeeze revierten inmediatamente (alto MAE relativo al MFE).",
  },
  {
    strategyId: "research-volume-confirmation-v1",
    strategyName: "Volume Participation Confirmation (Fase 17)",
    family: "B — Volume / Participation Confirmation",
    hypothesis:
      "Un movimiento de precio de corto plazo acompañado de una participación/volumen anormalmente alta (z-score de volumen elevado) puede tener mayor persistencia que un movimiento de magnitud similar sin esa confirmación.",
    expectedRegime: "STRONG_BULL/STRONG_BEAR con participación real; HIGH_VOLATILITY.",
    expectedFailureRegime: "LOW_VOLATILITY/RANGE, donde los picos de volumen suelen ser ruido (p.ej. una sola vela atípica) más que participación direccional sostenida; datos de volumen poco fiables.",
    entryLogic:
      "1) priceReturn = (close_actual − close_hace_priceLookback_velas) / close_hace_priceLookback_velas — usa solo velas estrictamente pasadas más la actual. 2) volumeZ = z-score del volumen de la vela ACTUAL sobre las volumeZPeriod velas previas (incluida ella misma, igual que el resto del snapshot de features — el volumen de la vela actual es información disponible en el instante de decisión, el mismo instante en que su close ya se usa). 3) LONG si priceReturn > priceThreshold Y volumeZ > volumeZThreshold. SHORT si priceReturn < −priceThreshold Y volumeZ > volumeZThreshold (participación alta en ambas direcciones, nunca volumen bajo).",
    exitLogic: "Igual convención que el resto de baselines: SL/TP fijos calculados en la entrada.",
    slLogic: "stopDistance = ATR(volatilityPeriod) de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { priceLookback: 5, priceThreshold: 0.01, volumeZPeriod: 20, volumeZThreshold: 1.5, volatilityPeriod: 14, rrr: 1.5 },
    parameterJustification:
      "priceLookback=5 y priceThreshold=0.01 (1%) son una ventana corta y un umbral redondo, comparables en orden de magnitud al momentumThreshold=0.02/lookback=10 de Momentum Baseline (Fase 11) pero deliberadamente distintos para no ser una copia con un parámetro cambiado. volumeZPeriod=20 reutiliza literalmente el mismo periodo que volumeZScore20 ya calculado en el Feature Engine (computeLatestFeatures). volumeZThreshold=1.5 desviaciones estándar es un umbral estadístico estándar y explícito ('más de 1.5σ por encima de lo normal'), no ajustado por resultado. volatilityPeriod=14 y rrr=1.5 son los mismos que el resto de baselines.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si estas operaciones (movimiento + volumen alto) no muestran mejor persistencia (avg R, win rate) que Momentum Baseline (que usa el mismo tipo de señal de retorno SIN filtro de volumen) sobre el mismo dataset — es decir, si el filtro de volumen no añade nada medible.",
  },
  {
    strategyId: "research-trend-pullback-v1",
    strategyName: "Trend + Pullback Entry (Fase 17)",
    family: "C — Trend + Pullback",
    hypothesis:
      "Entrar durante un retroceso dentro de una tendencia ya establecida y estable puede ofrecer una relación riesgo/beneficio distinta que entrar directamente en una extensión de la tendencia (perseguir nuevos máximos/mínimos).",
    expectedRegime: "BULL/STRONG_BULL (lado LONG), BEAR/STRONG_BEAR (lado SHORT) — tendencias ya establecidas.",
    expectedFailureRegime: "RANGE/TRANSITION, donde un 'retroceso' es en realidad ruido o el inicio de una reversión completa (el retroceso nunca se resuelve como continuación).",
    entryLogic:
      "Separado en 3 etapas causales explícitas: (1) TREND DETECTION — SMA(fastPeriod) vs SMA(slowPeriod) sobre las velas hasta la actual define el contexto: fastMA > slowMA = contexto alcista, fastMA < slowMA = contexto bajista. (2) PULLBACK — sobre las pullbackBars velas estrictamente anteriores a la actual (nunca la actual), en contexto alcista se exige que el precio haya retrocedido netamente (close al inicio de esa ventana > close al final de esa ventana); simétrico en contexto bajista. (3) CONFIRMATION + ENTRY — la vela actual debe cerrar en la dirección de la tendencia respecto a la vela inmediatamente anterior (close_actual > close_previo en contexto alcista) Y seguir por encima de la SMA rápida (para no confundir una reversión completa con un simple retroceso). Solo si las 3 etapas se cumplen se genera la señal.",
    exitLogic: "Igual convención que el resto de baselines: SL/TP fijos calculados en la entrada.",
    slLogic: "stopDistance = ATR(volatilityPeriod) de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { fastPeriod: 20, slowPeriod: 50, pullbackBars: 3, volatilityPeriod: 14, rrr: 1.5 },
    parameterJustification:
      "fastPeriod=20/slowPeriod=50 son EXACTAMENTE los mismos periodos que Trend Following Baseline (Fase 11) — deliberado, para que la única diferencia estructural entre ambas estrategias sea el requisito de retroceso+confirmación, permitiendo una comparación limpia de la hipótesis. pullbackBars=3 es una ventana corta y explícita para un retroceso de corto plazo (no una tendencia distinta, solo una pausa dentro de la tendencia ya detectada). volatilityPeriod=14 y rrr=1.5 son los mismos que el resto de baselines (rrr=1.5, no el 2.0 de Trend Following Baseline, deliberadamente, porque esta es una hipótesis distinta y no debe heredar sin más el parámetro de riesgo de la otra).",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si las entradas por retroceso no muestran mejor average R / menor MAE que las entradas directas de Trend Following Baseline sobre el mismo dataset y contexto de tendencia — es decir, si esperar el retroceso no mejora la relación riesgo/beneficio frente a entrar directamente en la extensión.",
  },
  {
    strategyId: "research-breakout-confirmation-v1",
    strategyName: "Breakout + Confirmation (Fase 17)",
    family: "D — Breakout + Confirmation",
    hypothesis:
      "Un breakout acompañado de confirmación adicional (fuerza de cierre dentro del rango de la propia vela + participación de volumen) puede reducir falsos breakouts frente a un breakout puro (sin confirmación).",
    expectedRegime: "Cualquiera, pero se espera una tasa de falsos breakouts menor que Breakout Baseline específicamente en regímenes RANGE/TRANSITION.",
    expectedFailureRegime: "HIGH_VOLATILITY con gaps/mechas grandes, donde la 'posición de cierre' de una sola vela es poco fiable como señal de fuerza; entornos de baja liquidez donde el volumen es ruidoso.",
    entryLogic:
      "Mismo núcleo que Breakout Baseline (close actual rompe el máximo/mínimo de las lookback velas estrictamente anteriores, excluyendo la vela actual) MÁS DOS confirmaciones causales usando solo la vela actual: (a) closePosition = (close−low)/(high−low) para LONG (o (high−close)/(high−low) para SHORT) debe ser >= closePositionThreshold — el cierre debe estar en la parte fuerte del rango de la propia vela, no cerca de la mitad. (b) volumeZ de la vela actual debe ser >= volumeZThreshold. Solo dispara si la ruptura Y ambas confirmaciones se cumplen simultáneamente.",
    exitLogic: "Igual convención que el resto de baselines: SL/TP fijos calculados en la entrada.",
    slLogic: "stopDistance = ATR(volatilityPeriod) × atrMultiplier de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { lookback: 20, volatilityPeriod: 14, atrMultiplier: 1.5, rrr: 1.5, closePositionThreshold: 0.7, volumeZThreshold: 1 },
    parameterJustification:
      "lookback=20, volatilityPeriod=14, atrMultiplier=1.5, rrr=1.5 son EXACTAMENTE los mismos que Breakout Baseline (Fase 11) — deliberado, para que la única diferencia estructural sea el filtro de confirmación, permitiendo comparar directamente 'breakout puro' vs 'breakout confirmado' bajo parámetros de ruptura idénticos. closePositionThreshold=0.7 es un umbral redondo y explícito ('el cierre debe estar en el 70% superior/inferior del rango de la vela'). volumeZThreshold=1.0 es un umbral de confirmación más permisivo que el de la familia B (1.5σ) a propósito, porque aquí el volumen es solo una confirmación secundaria, no la señal principal.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si la tasa de operaciones perdedoras por reversión inmediata (SL alcanzado en pocas velas) no es menor que la de Breakout Baseline sobre el mismo dataset, o si el número de señales cae tanto que la muestra es demasiado pequeña para decir nada (en cuyo caso el resultado es INCONCLUSIVE, no una confirmación de la hipótesis).",
  },
  {
    strategyId: "research-momentum-reversal-v1",
    strategyName: "Momentum Exhaustion Reversal (Fase 17)",
    family: "E — Momentum Reversal",
    hypothesis:
      "Un movimiento extremo de corto plazo (RSI en zona extrema) que además muestra signos de agotamiento (el propio movimiento se está desacelerando, no acelerando) puede producir una reversión — una construcción estructuralmente distinta de Mean Reversion Baseline (que mide distancia z-score respecto a una media móvil, no extremos de RSI ni desaceleración).",
    expectedRegime: "HIGH_VOLATILITY con picos; techos/suelos de agotamiento dentro de STRONG_BULL/STRONG_BEAR; TRANSITION.",
    expectedFailureRegime: "STRONG_BULL/STRONG_BEAR con continuación sostenida, donde el RSI permanece en zona extrema durante mucho tiempo sin revertir (el modo de fallo clásico de cualquier estrategia de reversión por sobrecompra/sobreventa).",
    entryLogic:
      "1) RSI(rsiPeriod) de la vela actual debe estar en zona extrema: >= rsiOverbought (candidato SHORT) o <= rsiOversold (candidato LONG). 2) Desaceleración/agotamiento: |close_actual − close_previo| debe ser MENOR que |close_previo − close_dos_velas_antes| — el movimiento se está frenando, no acelerando (estructuralmente distinto de mirar la distancia a una media). Solo dispara si el RSI extremo Y la desaceleración se cumplen a la vez.",
    exitLogic: "Igual convención que el resto de baselines: SL/TP fijos calculados en la entrada.",
    slLogic: "stopDistance = ATR(volatilityPeriod) de la vela actual. SL = close ∓ stopDistance.",
    tpLogic: "TP = close ± stopDistance × rrr.",
    initialParams: { rsiPeriod: 14, rsiOverbought: 75, rsiOversold: 25, volatilityPeriod: 14, rrr: 1.5 },
    parameterJustification:
      "rsiPeriod=14 es el periodo estándar ya calculado por el Feature Engine (rsi14). rsiOverbought=75/rsiOversold=25 son umbrales más estrictos que el 70/30 de manual clásico, elegidos para exigir un extremo más genuino antes de mirar. No hay parámetro de 'lookback de desaceleración' que ajustar: la comparación es siempre entre las dos últimas variaciones consecutivas, la ventana más corta y simple posible. volatilityPeriod=14 y rrr=1.5 son los mismos que el resto de baselines.",
    falsificationCriteria:
      "La hipótesis queda debilitada/rechazada si estas operaciones no muestran mejor win rate / average R que simplemente operar en contra de cualquier lectura extrema de RSI (sin exigir desaceleración) — es decir, si la condición de agotamiento no añade nada medible — o si la mayoría de las pérdidas ocurren en STRONG_BULL/STRONG_BEAR por continuación (el modo de fallo ya anticipado).",
  },
];

export function getHypothesis(strategyId: string): StrategyHypothesis | undefined {
  return HYPOTHESIS_REGISTRY.find((h) => h.strategyId === strategyId);
}
