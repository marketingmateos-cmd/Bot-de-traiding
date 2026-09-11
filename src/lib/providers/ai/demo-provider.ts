import type {
  AIAnalystInput,
  AIAnalystOutput,
  AICriticInput,
  AICriticOutput,
  AIProvider,
} from "../types";

/**
 * Rule-based "AI" that runs with zero external calls. It produces the same
 * structured shape the real Anthropic-backed provider does, so the rest of
 * the system (Trade Gate, Journal, UI) never needs to know which one
 * answered. This is what keeps the whole lab usable with no API key.
 */
export class DemoAIProvider implements AIProvider {
  readonly id = "demo-rule-based";
  readonly isDemo = true;

  async analyze(input: AIAnalystInput) {
    const reasons: string[] = [];
    const risks: string[] = [];
    const invalidations: string[] = [];

    let score = 0;
    const trend = input.indicators.trend ?? 0;
    const momentum = input.indicators.momentum ?? 0;
    const rsi = input.indicators.rsi ?? 50;
    const volumeZ = input.indicators.volumeZScore ?? 0;

    if (input.strategySignal.direction === "LONG") {
      score += input.strategySignal.strength;
      reasons.push(`La estrategia "${input.strategySignal.kind}" emitió una señal LARGA (fuerza ${input.strategySignal.strength.toFixed(2)}).`);
    } else {
      score -= input.strategySignal.strength;
      reasons.push(`La estrategia "${input.strategySignal.kind}" emitió una señal CORTA (fuerza ${input.strategySignal.strength.toFixed(2)}).`);
    }

    if (Math.sign(trend) === Math.sign(score || 1)) {
      score += 0.15;
      reasons.push(`El indicador de tendencia (${trend.toFixed(2)}) coincide con la dirección propuesta.`);
    } else {
      score -= 0.2;
      risks.push(`El indicador de tendencia (${trend.toFixed(2)}) contradice la dirección propuesta.`);
    }

    if (input.regime === "BULL" || input.regime === "STRONG_BULL") {
      if (score > 0) score += 0.1;
      reasons.push(`El régimen de mercado es ${input.regime}.`);
    } else if (input.regime === "BEAR" || input.regime === "STRONG_BEAR") {
      if (score < 0) score += 0.1; // agrees with short bias magnitude, handled below
      reasons.push(`El régimen de mercado es ${input.regime}.`);
    } else if (input.regime === "HIGH_VOLATILITY") {
      risks.push("El régimen es de ALTA VOLATILIDAD: se aplican stops más amplios y menor confianza.");
      score *= 0.7;
    }

    if (rsi > 75) risks.push(`El RSI (${rsi.toFixed(1)}) indica condiciones de sobrecompra.`);
    if (rsi < 25) risks.push(`El RSI (${rsi.toFixed(1)}) indica condiciones de sobreventa.`);

    if (volumeZ < -1) risks.push("El volumen está muy por debajo de su media reciente — participación débil.");
    else if (volumeZ > 1.5) reasons.push("El volumen está elevado respecto a su media reciente, respaldando el movimiento.");

    const avgNewsSentiment =
      input.news.length > 0 ? input.news.reduce((s, n) => s + n.sentiment * (n.importance / 100), 0) / input.news.length : 0;
    if (Math.sign(avgNewsSentiment) !== 0) {
      if (Math.sign(avgNewsSentiment) === Math.sign(score)) {
        reasons.push(`El sentimiento de las noticias recientes (${avgNewsSentiment.toFixed(2)}) coincide con la señal.`);
      } else {
        risks.push(`El sentimiento de las noticias recientes (${avgNewsSentiment.toFixed(2)}) no coincide con la señal.`);
        score -= 0.1;
      }
    }

    if (input.sentiment.divergence) {
      risks.push("Divergencia sentimiento/precio detectada — posible trampa o movimiento agotado.");
      score -= 0.15;
    }

    const missingOnChain = Object.values(input.onChain).filter((v) => v === null).length;
    const dataQuality = Math.max(0, input.marketIntelligence - missingOnChain * 3);
    if (dataQuality < 60) {
      risks.push("La calidad/confianza de los datos está por debajo de un umbral cómodo para esta decisión.");
    }

    invalidations.push(
      `Invalidar si el precio vuelve a cerrar a través del nivel de entrada con un giro de tendencia en el indicador "trend".`,
      `Invalidar si el régimen de mercado deja de ser ${input.regime} antes de alcanzar el objetivo.`
    );

    const confidence = Math.max(0, Math.min(1, (Math.abs(score) + 0.35) / 1.5));
    const signal: AIAnalystOutput["signal"] = Math.abs(score) < 0.12 ? "FLAT" : score > 0 ? "LONG" : "SHORT";

    let recommendation: AIAnalystOutput["recommendation"] = "APPROVE";
    if (signal === "FLAT" || dataQuality < 40) recommendation = "REJECT";
    else if (confidence < 0.55 || risks.length >= 3) recommendation = "LOW_CONFIDENCE";

    const output: AIAnalystOutput = {
      signal,
      confidence: Number(confidence.toFixed(2)),
      reasons,
      risks,
      invalidation_conditions: invalidations,
      data_quality: Math.round(dataQuality),
      recommendation,
    };

    return { output, tokensIn: 0, tokensOut: 0, model: this.id };
  }

  async critique(input: AICriticInput) {
    const challenged: string[] = [];
    const biases: string[] = [];
    let overfitting = false;

    if (input.analyst.confidence > 0.85 && input.analyst.risks.length === 0) {
      challenged.push("La confianza es muy alta sin ningún riesgo listado — esa combinación en sí misma es sospechosa.");
      biases.push("Posible sesgo de confirmación: solo se mostraron razones que apoyan la señal.");
    }

    if (input.historicalStrategyStats) {
      const { trades, winRate, sharpe } = input.historicalStrategyStats;
      if (trades < 30) {
        challenged.push(`Solo existen ${trades} operaciones históricas para esta versión de estrategia — muestra demasiado pequeña para confiar en la ventaja.`);
        overfitting = true;
      }
      if (winRate > 0.75 && trades < 50) {
        challenged.push(`Una tasa de acierto del ${(winRate * 100).toFixed(0)}% en una muestra pequeña es más propia de la varianza que de una ventaja real.`);
      }
      if (sharpe !== null && sharpe < 0.3) {
        challenged.push(`El ratio de Sharpe histórico (${sharpe.toFixed(2)}) es débil; aprobar sobre esa base añade riesgo sin evidencia de ventaja.`);
      }
    } else {
      challenged.push("No se proporcionaron estadísticas históricas de rendimiento para esta versión de estrategia — la evidencia es INSUFICIENTE por defecto.");
      overfitting = true;
    }

    if (input.context.regime === "TRANSITION") {
      challenged.push("El régimen es de TRANSICIÓN — las señales generadas durante transiciones de régimen son históricamente menos fiables.");
    }

    if (input.context.riskContext.openExposurePct > 0.6) {
      challenged.push(`La cuenta ya está expuesta en un ${(input.context.riskContext.openExposurePct * 100).toFixed(0)}%; añadir más concentra el riesgo.`);
    }

    const dataQualityLow = input.analyst.data_quality < 55;
    if (dataQualityLow) challenged.push(`La puntuación de calidad/confianza de los datos (${input.analyst.data_quality}) es demasiado baja para confiar en esta señal.`);

    let verdict: AICriticOutput["verdict"] = "APPROVED";
    if (dataQualityLow || input.analyst.recommendation === "REJECT") verdict = "BLOCKED";
    else if (challenged.length >= 2 || input.analyst.recommendation === "LOW_CONFIDENCE" || overfitting) verdict = "LOW_CONFIDENCE";

    const output: AICriticOutput = {
      verdict,
      challengedReasons: challenged,
      biasesFound: biases,
      overfittingConcern: overfitting,
      notes:
        verdict === "APPROVED"
          ? "No se encontraron problemas descalificantes; la hipótesis sobrevive a la revisión adversarial."
          : "Se plantearon una o más objeciones; ver challengedReasons.",
    };

    return { output, tokensIn: 0, tokensOut: 0, model: this.id };
  }
}
