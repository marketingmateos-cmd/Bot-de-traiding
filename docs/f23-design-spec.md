# F23 — Diseño, Especificación y Preparación del Pipeline

**Esta fase es exclusivamente de DISEÑO, ESPECIFICACIÓN, TESTS y
PREPARACIÓN DEL PIPELINE.** No se ejecuta ningún backtest, no se crea
ningún `ResearchDataset`, no se descarga histórico adicional de MT5, no
hay ninguna operación de trading ni ejecución. F23 en sí misma **NO SE
INICIA** con este commit — queda completamente detenida hasta recibir una
instrucción explícita posterior.

El código fuente de referencia es `src/lib/research/phase23PreRegistration.ts`
(la especificación congelada, machine-readable) y
`src/lib/research/multipleComparisonsCorrection.ts` (el único módulo de
infraestructura genuinamente nuevo de esta fase). Si este documento y el
código alguna vez difieren, el código (y sus tests) gana.

---

## 1. Postura de seguridad (sin cambios)

- `ENABLE_DEMO_EXECUTION` permanece `false`.
- Ningún `order_send`, ninguna API de ejecución, en ningún archivo de esta fase.
- No se toca `.env.local`, no se imprime ninguna credencial.
- No se crea ningún `ResearchDataset` — ver §3.

## 2. Universo autorizado — leído dinámicamente, nunca hardcodeado

`buildF23Universe()` proyecta `getAuthorizedEntries()` de
`mt5ResearchUniverseV1.ts` (commit `48438b1`, auditoría post-fix preparada
en `688ebea`) a los campos que F23 necesita (símbolo canónico, timeframe,
clase de activo). **Hoy** eso resuelve a exactamente estas 9 combinaciones:

| Símbolo | Timeframes | Clase |
|---|---|---|
| EURUSD | H1, H4, D1 | FX |
| USDJPY | H1, H4, D1 | FX |
| XAUUSD | H1, H4, D1 | METAL |

BTCUSD, ETHUSD y US500 **NO** aparecen — su auditoría post-fix real está
pendiente (commit `688ebea`), y `researchFitness` para esos 9 pares sigue
siendo `NOT_AUTHORIZED_FOR_RESEARCH`. `buildF23Universe()` no contiene el
nombre "BTCUSD" en ningún punto de su lógica — si la auditoría pendiente
cambia su estado a `AUTHORIZED_FOR_RESEARCH`, aparecerán en el universo de
F23 automáticamente, sin ningún cambio de código
(`phase23PreRegistration.test.ts` prueba este mecanismo inyectando una
entrada BTCUSD sintética, sin mutar el registro real).

## 3. Por qué F23 NO congela un `FROZEN_DATASET` (diferencia deliberada con F18-F22)

F18-F22 congelaban un dataset con fechas/hash reales porque ese dataset ya
estaba `registerResearchDataset()`-ado. **Ningún `ResearchDataset` existe
todavía para EURUSD/USDJPY/XAUUSD** — el Research Universe v1 es
explícitamente de solo lectura hasta una fase de ingesta separada (regla
`read-only-until-explicit-ingestion-phase`). Fabricar fechas/hash aquí
violaría "F23 NO DEBE INVENTAR DATOS DE MERCADO". Cuando la ingesta ocurra
(fase futura, explícita, fuera del alcance de este diseño), sus hechos
confirmados se añadirán a `phase23PreRegistration.ts` **antes** de correr
Discovery — un test estructural (`phase23PreRegistration.test.ts`) verifica
que este archivo no contiene ningún `FROZEN_DATASET` ni hash literal hoy.

## 4. Ventanas temporales / splits IS-Validation-OOS

`buildF23Ranges(startDate, endDate)` reutiliza sin reimplementar el split
cronológico 60/20/20 ya auditado (`computeIsValidationOosRanges` de
`hypothesisValidation.ts`, usado sin cambios desde F13). No se invoca con
fechas reales en este commit — la fase de ingesta lo hará con el rango
confirmado real. Garantiza (y lo prueba `phase23PipelineValidation.test.ts`)
que IS, Validation y OOS son estrictamente disjuntos y cronológicos: IS
termina antes de que empiece Validation, Validation termina antes de que
empiece OOS — nunca información futura filtrándose a una etapa anterior.

## 5. Reglas de walk-forward

`FROZEN_WALK_FORWARD_OPTIONS` reutiliza `SUPPLEMENTARY_WALK_FORWARD_OPTIONS`
de F13/F18 sin cambios (`windowSizeDays: 90, trainFraction: 0.7, stepDays: 45`).
Cuando exista un dataset real ingerido, debe verificarse (como ya hace
`hypothesisValidation.test.ts` para el dataset BTC) que al menos una
ventana cabe dentro del rango real disponible.

## 6. Métricas

`FROZEN_F23_METRICS`: `tradeCount`, `cumulativeReturnPct`, `cagrPct`,
`volatilityPct`, `maxDrawdownPct`, `sharpeRatio`, `sortinoRatio`,
`winRatePct`, `profitFactor`, `expectancyPct`, `returnDistribution`.
**Ninguna métrica individual es criterio de aprobación por sí sola** — la
combinación se decide vía `phase18Evidence.classifyStrategyEvidence()`
(reutilizado) y `FROZEN_NO_EDGE_CRITERIA` (§10).

## 7. Costes y modelo de slippage

`FROZEN_COST_MODEL` reutiliza `BASELINE_COST_MODEL` (`feeBps: 10,
slippageBps: 5`, el mismo supuesto que F11/F17/F18/F19 usan para sus
estrategias), marcado explícitamente `confirmed: false` — **este supuesto
NO ha sido confirmado contra el spread real del broker para FX/Metal**
(ninguna fase MT5 hasta ahora capturó bid/ask, solo OHLCV). Las pruebas de
robustez (`FROZEN_STRESS_SCENARIOS`, reutilizadas de F19 sin cambios: BASE
+ 5 escenarios de stress de fees/slippage hasta +50%/+50%) existen
precisamente para acotar el riesgo de que este supuesto sea optimista.

## 8. Criterios mínimos de muestra

`MIN_SAMPLE_SIZE = 20` — la misma cifra reutilizada literalmente en cada
fase desde F12 (convención del repositorio: cada archivo de pre-registro
la redeclara como constante propia en vez de importarla entre fases
numeradas, para que cada fase quede auto-contenida; `regimeAnalysis.ts` es
la fuente original). Un segmento OOS con menos de 20 operaciones nunca
produce un veredicto forzado — se marca `INCONCLUSIVE`.

## 9. Significancia y corrección por múltiples comparaciones

**F23 es la primera fase de este repositorio que busca sobre muchas
configuraciones (familia × activo × timeframe × punto de grid) a la vez**
— exactamente el escenario en el que varios resultados "significativos" se
esperan por puro azar si no se corrige. Nada en este repositorio corregía
por comparaciones múltiples antes de F23 (la "comparación incremental" de
F20, `phase20Comparison.ts`, es un concepto distinto: redundancia entre dos
estrategias ya seleccionadas, no una corrección estadística).

`src/lib/research/multipleComparisonsCorrection.ts` (módulo nuevo)
implementa dos métodos estándar, **reportados siempre juntos, nunca
eligiendo el más favorable después de ver los p-valores**:

- **Bonferroni** (`applyBonferroniCorrection`): controla la tasa de error
  familywise — el límite estricto (probabilidad de AL MENOS un falso
  positivo en todo el lote).
- **Benjamini-Hochberg FDR** (`applyBenjaminiHochbergFDR`): controla la
  tasa de falso descubrimiento esperada entre los declarados
  significativos — el estándar para búsquedas grandes, procedimiento
  step-up (un resultado puede ser significativo aunque falle su propio
  umbral individual, si un rango superior lo arrastra).

`FROZEN_SIGNIFICANCE_CONFIG`: `familywiseAlpha = 0.05`,
`fdrQ = 0.10`, método primario `benjamini_hochberg_fdr`, método secundario
(reportado siempre junto) `bonferroni`.

### Conteo de configuraciones — bookkeeping obligatorio

`countF23TotalConfigurations()` registra, de forma determinista y pura:

- número total de configuraciones probadas
- número de familias
- número de activos
- número de timeframes
- número de tests estadísticos (= nº de configuraciones; cada
  configuración produce exactamente 1 test en Discovery, documentado
  explícitamente para que ningún otro módulo lo asuma implícitamente)

`countGridPoints(bounds)` calcula el tamaño de grid de cada familia a
partir de sus `parameterSearchBounds` (min/max/step). Ninguna familia
excede `FROZEN_MAX_GRID_POINTS_PER_FAMILY` (200) — verificado por test.

## 10. Monte Carlo / bootstrap

Reutiliza el motor de `phase19MonteCarlo.ts` (bootstrap, block bootstrap,
`applyCostStress`, `classifyRobustness`) **sin reimplementarlo**.
`FROZEN_MONTE_CARLO_CONFIG = { seed: 23, iterations: 10_000 }` — seed
nuevo (23), distinto de F19 (19)/F20 (20)/F21 (21), para que el
remuestreo de F23 nunca coincida por accidente con el de una fase previa,
misma convención de iteraciones.

## 11. Reglas de parada (`FROZEN_STOPPING_RULES`)

1. STOP si el dataset ingerido para cualquier par autorizado tiene menos
   de ~30 días de rango total.
2. STOP (marcar `INCONCLUSIVE`, nunca forzar veredicto) si el segmento OOS
   de una configuración tiene menos de `MIN_SAMPLE_SIZE` operaciones.
3. STOP Discovery en su totalidad si el universo autorizado queda vacío.
4. STOP y re-registrar la fase completa desde cero si se detecta un
   parámetro modificado después de observar Validation u OOS.
5. STOP la búsqueda de una familia si excede
   `FROZEN_MAX_GRID_POINTS_PER_FAMILY`.
6. STOP — no descargar histórico adicional de MT5 bajo ninguna
   circunstancia dentro de esta fase, ni siquiera para ampliar una muestra
   insuficiente (eso sería seleccionar datos por resultado).

## 12. Criterios objetivos de "no edge" (`FROZEN_NO_EDGE_CRITERIA`)

Una configuración se declara objetivamente SIN EDGE si se cumple
**cualquiera** de estas condiciones, sin excepción:

1. `phase18Evidence.classifyStrategyEvidence()` devuelve `NEGATIVE` o `REJECTED`.
2. Devuelve `INCONCLUSIVE` por muestra insuficiente, sin poder ampliarla
   dentro del rango ya confirmado.
3. El p-valor empírico no sobrevive ni FDR ni Bonferroni frente al total
   de configuraciones de su familia.
4. `phase19MonteCarlo.classifyRobustness()` devuelve `FRAGILE` o
   `NEGATIVE_ROBUST` bajo el escenario de stress más severo.
5. Depende de un único activo/timeframe, sin confirmación en al menos un
   segundo par autorizado de la misma familia.

## 13. Familias de investigación A-G — diseño, no implementación

Cada familia declara: hipótesis falsable, variables, límites de búsqueda
de parámetros (grid), justificación económica/estadística, qué
constituiría evidencia a favor, y qué constituiría falsación. **Ninguna
está implementada como `StrategyDefinition`** (`implemented: false` en
las 7) — esta fase diseña, no ejecuta.

| ID | Nombre | Hipótesis (resumen) | Requiere cross-sectional |
|---|---|---|---|
| F23-A | Mean Reversion Extrema | Reversión tras desviación extrema (z-score) respecto a la media móvil | No |
| F23-B | Momentum / Continuation | Persistencia direccional tras movimiento sostenido | No |
| F23-C | Volatility Regime | Retorno esperado difiere entre régimen de volatilidad ALTA/BAJA | No |
| F23-D | Breakout | Ruptura tras compresión de volatilidad predice continuación | No |
| F23-E | Cross-Sectional / Relative Behaviour | Spread/ratio entre 2 activos del universo exhibe señal sistemática | **Sí (>=2 activos)** |
| F23-F | Time-of-Day / Session Effects | Retorno/volatilidad difieren por sesión ASIA/LONDON/NY | No |
| F23-G | Trend + Volatility Interaction | Momentum es más confiable condicionado a volatilidad expandiéndose (interacción B×C) | No |

Notas de diseño:

- **F23-D** es la misma familia ya explorada para cripto en F17-A/F20-E;
  F23 prueba si el mecanismo generaliza a un universo estructuralmente
  distinto (FX/Metal) — un test de generalización, no una repetición.
- **F23-E** es la única que requiere >=2 activos simultáneos — solo
  evaluable porque el universo autorizado hoy tiene 3 activos distintos
  (antes de F23, ningún universo de investigación de este repositorio
  tenía más de un activo comparable simultáneamente relevante para esta
  familia).
- **F23-F** es más natural para FX/Gold que para cripto: a diferencia de
  cripto (24/7, la razón por la que F20-D fue un estudio descriptivo
  estricto sobre datos 24/7), FX y Gold son instrumentos genuinamente
  impulsados por sesión — mismo estándar de evidencia estricto que F20-D
  (`SUPPORTED`, no `WEAK_SUPPORT`) dado el riesgo de comparaciones
  múltiples entre 3 buckets.
- **F23-G** prueba explícitamente si combinar F23-B y F23-C aporta
  información incremental más allá de cada una por separado — un test de
  interacción con justificación propia, no una familia redundante.

Los límites de grid exactos (`parameterSearchBounds`) de cada familia
viven en `phase23PreRegistration.ts` — nunca se amplían tras ver
resultados de Discovery (spec Condición 4/8).

## 14. Los 10 principios — cómo los honra el diseño

| # | Principio | Mecanismo |
|---|---|---|
| 1 | Separación estricta de etapas | `FROZEN_PIPELINE_STAGES` (orden fijo de 6 etapas) |
| 2 | No usar información futura | `buildF23Ranges()` reutiliza el split cronológico auditado; probado sin solapamiento |
| 3 | No seleccionar estrategias por resultado OOS | Regla de parada 4; ninguna familia se "sustituye" tras ver resultados |
| 4 | No reutilizar el mismo periodo para Discovery y Validation | Mismo split 60/20/20, segmentos disjuntos probados |
| 5 | No declarar edge por un único activo/timeframe | `FROZEN_NO_EDGE_CRITERIA` condición 5 |
| 6 | Corregir por múltiples comparaciones | `multipleComparisonsCorrection.ts` (FDR + Bonferroni, siempre ambos) |
| 7 | Registrar todas las hipótesis probadas, incl. negativas | `countF23TotalConfigurations()` cuenta el total ANTES de ejecutar; `FROZEN_NO_EDGE_CRITERIA` es una clasificación registrada, nunca un descarte silencioso |
| 8 | No cambiar parámetros tras ver OOS | Regla de parada 4 (invalida la fase completa) |
| 9 | Sobrevivir IS+Validation+OOS+WF+Robustez | `phase18Evidence` (SUPPORTED exige los 3 segmentos + mayoría walk-forward) + `phase19MonteCarlo.classifyRobustness` |
| 10 | OOS desfavorable = fallida aunque IS sea positiva | `classifyStrategyEvidence()` devuelve `REJECTED` en ese caso exacto — probado con la función real, no reimplementada |

## 15. Qué NO hace este commit

- No ejecuta Discovery, Validation, OOS, walk-forward ni robustez sobre
  ningún dato real.
- No crea ningún `ResearchDataset`.
- No descarga histórico adicional de MT5.
- No implementa ninguna de las 7 familias como `StrategyDefinition`.
- No modifica el Research Universe v1 (`mt5ResearchUniverseV1.ts`) ni su
  auditoría pendiente.

**F23 permanece detenida.** Iniciarla (Discovery real) requiere: (1) una
fase de ingesta explícita que registre un `ResearchDataset` real para al
menos un par del universo autorizado, y (2) una instrucción explícita
posterior del usuario.
