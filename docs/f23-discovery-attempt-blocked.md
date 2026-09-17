# F23 Discovery — intento de ejecución, BLOQUEADO por falta de datos reales

**Resultado: Discovery NO se ejecutó. Cero configuraciones probadas, cero
tests estadísticos, cero resultados (ni positivos ni negativos).** Este
documento registra por qué, siguiendo exactamente la instrucción del propio
pre-registro: *"Si el pipeline actualmente no tiene implementada la
creación de datasets F23, no improvises una arquitectura nueva: documenta
el bloqueo y detente antes de inventar una implementación."*

## 1. Lo que se verificó primero (correcto, según el pre-registro)

`buildF23Universe()` (`src/lib/research/phase23PreRegistration.ts`, commit
`11acafb`) fue invocado contra `mt5ResearchUniverseV1.getAuthorizedEntries()`
en vivo. Confirma dinámicamente el universo esperado por el usuario:

```
EURUSD H1, EURUSD H4, EURUSD D1,
USDJPY H1, USDJPY H4, USDJPY D1,
XAUUSD H1, XAUUSD H4, XAUUSD D1
```

9 combinaciones, 3 activos, 3 timeframes — exactamente lo declarado en el
pre-registro, sin necesidad de ningún cambio de código.

## 2. El bloqueo — inspección directa de la base de datos

```
Asset (tabla completa): BTC, ETH, SOL, XRP, BNB, DOGE, ADA
MarketData: filas SOLO para BTC y ETH (H1/H4/D1)
ResearchDataset: filas SOLO para BTC y ETH (source: binance_csv / binance_csv_resampled_h1)
```

**No existe ningún `Asset`, ninguna fila de `MarketData`, ni ningún
`ResearchDataset` para EURUSD, USDJPY o XAUUSD en esta base de datos.**
Búsqueda adicional en el repositorio completo (excluyendo
`node_modules`/`.git`) de cualquier archivo con esos nombres: cero
resultados. Ningún archivo CSV/JSON con velas reales de estos tres
símbolos existe en este entorno.

Esto es consistente con el propio `docs/mt5-research-universe-v1.md` §9 y
`docs/f23-design-spec.md` §3: el Research Universe v1 es **puramente
declarativo/read-only** — registra que estos 9 pares están *autorizados
para investigación futura*, nunca que sus velas ya fueron descargadas o
persistidas. Las fases MT5 anteriores (`mt5_historical_discovery.py`,
`mt5_symbol_resolution.py`) solo probaron/muestrearon datos EN el
terminal MT5 real de Windows del usuario y reportaron agregados
(conteos, hashes no capturados, clasificación de gaps) — nunca
transfirieron las velas en sí a este repositorio ni a esta base de datos.

## 3. Por qué Discovery no puede ejecutarse sin esto

Las 7 familias del pre-registro (F23-A a F23-G) requieren, como mínimo,
una serie temporal de precios real para calcular cualquier métrica:
z-scores de desviación (F23-A), retorno tras momentum (F23-B), percentiles
de ATR por régimen (F23-C), rupturas tras compresión (F23-D), spread/ratio
entre activos (F23-E), retorno por sesión (F23-F), interacción
momentum×volatilidad (F23-G). **Sin una sola vela real de EURUSD, USDJPY o
XAUUSD, ninguna de las 7 familias tiene sobre qué calcular nada** —
esto no es una limitación de una familia en particular, es un bloqueo
total y simétrico sobre las 9 combinaciones del universo.

## 4. Qué NO se hizo (deliberadamente, por instrucción explícita)

- **No se fabricaron datos sintéticos** para simular EURUSD/USDJPY/XAUUSD
  — violaría "F23 NO DEBE INVENTAR DATOS DE MERCADO" y "no crear datos
  sintéticos que puedan confundirse con datos reales".
- **No se descargó histórico nuevo de MT5** — este sandbox es Linux y no
  puede conectar con un terminal MT5 real (limitación arquitectónica ya
  documentada en `python/mt5_data_connector.py`); y aunque pudiera, la
  instrucción de esta fase es no descargar salvo estrictamente necesario,
  y de cualquier forma ingerir datos reales es una fase de ingesta
  separada y explícita, no parte de Discovery.
- **No se improvisó una arquitectura nueva de creación de datasets F23**
  — el pipeline de ingesta MT5 YA EXISTE
  (`src/lib/marketData/mt5HistoricalIngestion.ts` +
  `scripts/mt5-ingest-historical.mjs`, construido en la fase "MT5 Data",
  tareas #143-149) y es el camino correcto para una futura fase de
  ingesta — nunca se reconstruyó ni se duplicó aquí.
- **No se ejecutó ninguna configuración parcial** usando datos de otro
  activo (p. ej. BTC/ETH) disfrazados de FX/Metal — eso habría producido
  resultados que podrían confundirse con investigación real sobre el
  universo autorizado.

## 5. Camino para desbloquear (fase futura, explícita, fuera de este commit)

1. Ejecutar una fase de ingesta MT5 real (Windows, terminal MT5 DEMO en
   vivo) usando el pipeline ya existente
   (`mt5HistoricalIngestion.ts`/`mt5-ingest-historical.mjs`) para al menos
   uno de los 9 pares autorizados — esto registraría un `ResearchDataset`
   real con hash/provenance, exactamente como F21/F22 lo hicieron para
   BTC/ETH.
2. Una vez exista al menos un `ResearchDataset` real para el universo
   autorizado, `buildF23Ranges()` puede invocarse con fechas reales y
   Discovery puede ejecutarse por primera vez sobre datos genuinos.
3. Esto requiere una instrucción explícita separada del usuario — no se
   asume ni se inicia aquí.

## 6. Seguridad (sin cambios, verificado)

`ENABLE_DEMO_EXECUTION` permanece `false`. Cero llamadas `order_send`.
Cero conexión de ejecución. `.env.local` no tocado. Ninguna credencial
impresa. Ningún `ResearchDataset` fue creado (no había datos que
registrar). Ninguna operación de trading, en ningún punto.
