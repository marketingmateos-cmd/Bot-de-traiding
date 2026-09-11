export type PostMortemClassification =
  | "GOOD_EXECUTION"
  | "BAD_EXECUTION"
  | "GOOD_IDEA_BAD_RESULT"
  | "BAD_IDEA_GOOD_RESULT"
  | "INSUFFICIENT_DATA"
  | "ANOMALY";

export interface PostMortemInput {
  netPnl: number;
  hypothesisWasSound: boolean | null; // was the AI Analyst+Critic combo well-reasoned given the info they had at the time?
  regimeWasAppropriate: boolean;
  hadContradictingInformation: boolean;
  exitReason: string;
  mae: number; // as a fraction, e.g. 0.03 = 3%
  stopLossFraction: number | null; // configured stop distance as a fraction
}

export interface PostMortemResult {
  classification: PostMortemClassification;
  notes: string;
}

/**
 * Automatic Post-Mortem (spec §33). Runs after every closed trade to answer
 * "was this a good decision, independent of the outcome?" — directly
 * implementing the idea that a winning trade can still have been a bad
 * decision (and vice versa), which is the core defense against confusing
 * luck with edge.
 */
export function runPostMortem(input: PostMortemInput): PostMortemResult {
  if (input.hypothesisWasSound === null) {
    return { classification: "INSUFFICIENT_DATA", notes: "No recorded AI analysis/critic verdict to evaluate the original hypothesis against." };
  }

  if (!Number.isFinite(input.netPnl) || Math.abs(input.netPnl) > 1e9) {
    return { classification: "ANOMALY", notes: "Trade P&L is non-finite or implausibly large — flagging for manual review." };
  }

  const won = input.netPnl > 0;
  const goodIdea = input.hypothesisWasSound && input.regimeWasAppropriate && !input.hadContradictingInformation;

  if (goodIdea && won) {
    return { classification: "GOOD_EXECUTION", notes: "Well-reasoned entry in a compatible regime, and it worked out." };
  }
  if (!goodIdea && !won) {
    return { classification: "BAD_EXECUTION", notes: "Entry had known weaknesses (wrong regime, contradicting information, or weak hypothesis) and lost — as expected." };
  }
  if (goodIdea && !won) {
    return {
      classification: "GOOD_IDEA_BAD_RESULT",
      notes: `The reasoning was sound but the trade lost (exit: ${input.exitReason}). This is normal variance, not a reason to change the strategy.`,
    };
  }
  return {
    classification: "BAD_IDEA_GOOD_RESULT",
    notes: "The entry had known weaknesses but the trade won anyway. Treat this as luck, not validation — do not increase confidence in this setup from this result alone.",
  };
}
