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
      reasons.push(`Strategy "${input.strategySignal.kind}" emitted a LONG signal (strength ${input.strategySignal.strength.toFixed(2)}).`);
    } else {
      score -= input.strategySignal.strength;
      reasons.push(`Strategy "${input.strategySignal.kind}" emitted a SHORT signal (strength ${input.strategySignal.strength.toFixed(2)}).`);
    }

    if (Math.sign(trend) === Math.sign(score || 1)) {
      score += 0.15;
      reasons.push(`Trend indicator (${trend.toFixed(2)}) agrees with the proposed direction.`);
    } else {
      score -= 0.2;
      risks.push(`Trend indicator (${trend.toFixed(2)}) disagrees with the proposed direction.`);
    }

    if (input.regime === "BULL" || input.regime === "STRONG_BULL") {
      if (score > 0) score += 0.1;
      reasons.push(`Market regime is ${input.regime}.`);
    } else if (input.regime === "BEAR" || input.regime === "STRONG_BEAR") {
      if (score < 0) score += 0.1; // agrees with short bias magnitude, handled below
      reasons.push(`Market regime is ${input.regime}.`);
    } else if (input.regime === "HIGH_VOLATILITY") {
      risks.push("Regime is HIGH_VOLATILITY: wider stops and reduced confidence apply.");
      score *= 0.7;
    }

    if (rsi > 75) risks.push(`RSI (${rsi.toFixed(1)}) indicates overbought conditions.`);
    if (rsi < 25) risks.push(`RSI (${rsi.toFixed(1)}) indicates oversold conditions.`);

    if (volumeZ < -1) risks.push("Volume is well below its recent average — weak participation.");
    else if (volumeZ > 1.5) reasons.push("Volume is elevated versus its recent average, supporting the move.");

    const avgNewsSentiment =
      input.news.length > 0 ? input.news.reduce((s, n) => s + n.sentiment * (n.importance / 100), 0) / input.news.length : 0;
    if (Math.sign(avgNewsSentiment) !== 0) {
      if (Math.sign(avgNewsSentiment) === Math.sign(score)) {
        reasons.push(`Recent news sentiment (${avgNewsSentiment.toFixed(2)}) aligns with the signal.`);
      } else {
        risks.push(`Recent news sentiment (${avgNewsSentiment.toFixed(2)}) is misaligned with the signal.`);
        score -= 0.1;
      }
    }

    if (input.sentiment.divergence) {
      risks.push("Sentiment/price divergence detected — potential trap or exhausted move.");
      score -= 0.15;
    }

    const missingOnChain = Object.values(input.onChain).filter((v) => v === null).length;
    const dataQuality = Math.max(0, input.marketIntelligence - missingOnChain * 3);
    if (dataQuality < 60) {
      risks.push("Data quality/confidence is below a comfortable threshold for this decision.");
    }

    invalidations.push(
      `Invalidate if price closes back through the entry level with a trend flip in indicator "trend".`,
      `Invalidate if market regime transitions away from ${input.regime} before target is reached.`
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
      challenged.push("Confidence is very high with zero listed risks — that combination itself is suspicious.");
      biases.push("Possible confirmation bias: only supporting reasons were surfaced.");
    }

    if (input.historicalStrategyStats) {
      const { trades, winRate, sharpe } = input.historicalStrategyStats;
      if (trades < 30) {
        challenged.push(`Only ${trades} historical trades exist for this strategy version — too small a sample to trust the edge.`);
        overfitting = true;
      }
      if (winRate > 0.75 && trades < 50) {
        challenged.push(`Win rate of ${(winRate * 100).toFixed(0)}% on a small sample is more consistent with variance than edge.`);
      }
      if (sharpe !== null && sharpe < 0.3) {
        challenged.push(`Historical Sharpe ratio (${sharpe.toFixed(2)}) is weak; approving on top of it adds risk without evidence of an edge.`);
      }
    } else {
      challenged.push("No historical performance stats were supplied for this strategy version — evidence is INSUFFICIENT by default.");
      overfitting = true;
    }

    if (input.context.regime === "TRANSITION") {
      challenged.push("Regime is TRANSITION — signals generated during regime transitions are historically less reliable.");
    }

    if (input.context.riskContext.openExposurePct > 0.6) {
      challenged.push(`Account is already ${(input.context.riskContext.openExposurePct * 100).toFixed(0)}% exposed; adding more concentrates risk.`);
    }

    const dataQualityLow = input.analyst.data_quality < 55;
    if (dataQualityLow) challenged.push(`Data quality/confidence score (${input.analyst.data_quality}) is too low to trust this signal.`);

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
          ? "No disqualifying issues found; hypothesis survives adversarial review."
          : "One or more concerns were raised; see challengedReasons.",
    };

    return { output, tokensIn: 0, tokensOut: 0, model: this.id };
  }
}
