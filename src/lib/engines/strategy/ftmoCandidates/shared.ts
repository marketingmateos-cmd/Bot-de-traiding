/**
 * Candidatas FTMO — mismo supuesto de fee/slippage que las 4 estrategias
 * baseline de Fase 11 (`BASELINE_COST_MODEL`), reutilizado verbatim: el
 * coste de ejecución es un hecho del broker/activo, no una palanca de
 * control de riesgo — cambiarlo aquí falsearía la comparación frente a las
 * demás estrategias del Strategy Lab, no reduciría el riesgo real.
 */
export const FTMO_COST_MODEL = { feeBps: 10, slippageBps: 5 };
