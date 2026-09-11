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
    return { classification: "INSUFFICIENT_DATA", notes: "No hay veredicto de análisis/crítica de IA registrado con el que evaluar la hipótesis original." };
  }

  if (!Number.isFinite(input.netPnl) || Math.abs(input.netPnl) > 1e9) {
    return { classification: "ANOMALY", notes: "El P&L de la operación no es finito o es implausiblemente grande — se marca para revisión manual." };
  }

  const won = input.netPnl > 0;
  const goodIdea = input.hypothesisWasSound && input.regimeWasAppropriate && !input.hadContradictingInformation;

  if (goodIdea && won) {
    return { classification: "GOOD_EXECUTION", notes: "Entrada bien razonada en un régimen compatible, y salió bien." };
  }
  if (!goodIdea && !won) {
    return { classification: "BAD_EXECUTION", notes: "La entrada tenía debilidades conocidas (régimen incorrecto, información contradictoria o hipótesis débil) y perdió — como cabía esperar." };
  }
  if (goodIdea && !won) {
    return {
      classification: "GOOD_IDEA_BAD_RESULT",
      notes: `El razonamiento era sólido pero la operación perdió (salida: ${input.exitReason}). Esto es varianza normal, no un motivo para cambiar la estrategia.`,
    };
  }
  return {
    classification: "BAD_IDEA_GOOD_RESULT",
    notes: "La entrada tenía debilidades conocidas pero la operación ganó de todos modos. Trátalo como suerte, no como validación — no aumentes la confianza en este planteamiento solo por este resultado.",
  };
}
