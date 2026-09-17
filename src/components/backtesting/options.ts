export const STRATEGY_OPTIONS = [
  { id: "trend-following", name: "Seguimiento de Tendencia" },
  { id: "momentum", name: "Momentum" },
  { id: "breakout", name: "Ruptura" },
  { id: "mean-reversion", name: "Reversión a la Media" },
  { id: "volatility-expansion", name: "Volatilidad" },
  { id: "multi-timeframe", name: "Multi-Temporalidad" },
  { id: "event-driven", name: "Dirigida por Eventos" },
  // Multi-Estrategias Candidatas FTMO — preselección para rentabilidad
  // moderada/constante con riesgo bajo por operación (ver
  // src/lib/engines/strategy/ftmoCandidates/).
  { id: "trend-breakout-ftmo-v1", name: "Tendencia/Breakout FTMO (Candidata A)" },
  { id: "mean-reversion-ftmo-v1", name: "Reversión a la Media FTMO (Candidata B)" },
  { id: "ma-cross-momentum-ftmo-v1", name: "Cruce de Medias con Momentum FTMO (Candidata C)" },
];

export const ASSET_OPTIONS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA"];
