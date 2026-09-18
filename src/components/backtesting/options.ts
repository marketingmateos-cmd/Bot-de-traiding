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
  { id: "ma-cross-momentum-ftmo-v2", name: "Cruce de Medias con Momentum FTMO v2 (Candidata C — Filtro ATR + TP Dinámico)" },
  { id: "ma-cross-momentum-ftmo-v2-1", name: "Cruce de Medias con Momentum FTMO v2.1 (Candidata C — Filtro ATR 0.75x + TP Dinámico)" },
  { id: "momentum-breakout-ftmo-v1", name: "Apex Breakout FTMO (Candidata D)" },
  { id: "momentum-breakout-ftmo-v2", name: "Apex Breakout FTMO v2 (Candidata D — Circuit Breaker Anti-Racha)" },
];

export const ASSET_OPTIONS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA"];
