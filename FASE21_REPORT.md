# FASE 21 — Data Expansion + Research Kickoff (BTC + ETH multi-año) — Informe Final

**Fecha de ejecución real:** 2026-09-14
**Datasets:** BTCUSDT H1 y ETHUSDT H1, 2023-01-01 → 2026-08-31 (~3.5 años, 32135 velas cada uno)
**Dataset previo (Fase 11-20), verificado intacto antes Y después de esta fase:** BTCUSDT H1 2026-03-01→2026-08-31 (4416 velas), hash `8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503` ✅ byte-idéntico, sigue existiendo como fila `ResearchDataset` independiente
**Working tree:** limpio tras el commit final

---

## 0. Resumen ejecutivo

Se localizaron, auditaron, organizaron, importaron y validaron ~3.5 años de datos horarios reales de BTCUSDT y ETHUSDT (2023-01-01 → 2026-08-31), registrados vía `ResearchDataset` con hash y provenance completos, sin tocar ni recalcular el benchmark de 6 meses usado en Fases 11-20. Sobre el periodo IS (60%, 2023-01-01 → 2025-03-14, ~19281 velas por activo) se ejecutó Discovery para 6 familias de hipótesis pre-registradas (A-F), aplicando siempre la misma barrera estructural anti-contaminación (`tagAsIsOnly`) y clasificando cada bucket contra 0 mediante bootstrap de bloques — nunca contra un baseline elegido a posteriori.

**Dos buckets superaron el filtro de Discovery Y el filtro de consistencia cruzada BTC/ETH** (mismo signo, misma magnitud aproximada, ambos con CI95% que excluye 0): F21-B `h1_EXTREME_LOW` (reversión de 1h tras un mínimo extremo) y F21-C `HIGH_VOL` (continuación tras estado de volatilidad alta, en los 3 horizontes 6/12/24h). **Ninguno de los dos sobrevivió Validation ni OOS**: en ambos activos y ambos segmentos, el intervalo de confianza vuelve a cruzar 0, y en el caso de F21-C `h24_HIGH_VOL` en ETH el signo se invierte entre VALIDATION (+0.657%) y OOS (-0.556%) — el patrón de inestabilidad de signo que la metodología está diseñada para detectar y rechazar.

**Resultado final: 0 de 6 familias produce evidencia que sobreviva IS→VALIDATION→OOS en ambos activos.** Esto incluye una réplica independiente de F21-A/F20-A (autocorrelación) que confirma, ahora con 6x más muestra y un segundo activo, la ausencia de dependencia serial ya observada en Fase 20. El hallazgo honesto de esta fase es negativo — coherente con Fase 18, 19 y 20 — y se reporta como tal, sin forzar ninguno de los dos casi-supervivientes a una conclusión positiva.

---

## 1. Auditoría de datasets (Checkpoint 1-2)

### 1.1 Origen

Los 82 archivos ZIP (38 BTCUSDT-1h + 44 ETHUSDT-1h, klines mensuales de Binance, 2023-01 → 2026-02/08) fueron subidos directamente al repositorio remoto vía la interfaz web de GitHub, en dos commits (`578dac6`, `672ab44`) posteriores al último `fetch` local de esta sesión. Se detectaron mediante `git ls-remote --heads --tags origin` (que consulta el estado remoto real, sin caché de fetch local) tras una discrepancia remote-vs-local reportada explícitamente por el usuario; se hizo `fetch` + `merge --ff-only` sin conflictos.

### 1.2 Organización (sin modificar contenido)

`git mv` de los 82 ZIP a `data/raw/crypto/{BTCUSDT,ETHUSDT}/` (contenido byte-idéntico, solo cambia la ruta). Los 6 ZIP del benchmark original (`BTCUSDT-1h-2026-0{3..8}.zip`) se dejaron deliberadamente en la raíz, sin tocar, para minimizar cualquier riesgo sobre el benchmark protegido.

### 1.3 Auditoría independiente pre-importación

Se escribió un script de auditoría **separado** del importador (lee los CSV crudos directamente, sin pasar por `offlineImporter.ts`) para que un bug del importador no fuera auto-confirmatorio. Resultado, comparado byte-a-byte contra el propio reporte del importador tras la carga real:

| Métrica | BTCUSDT | ETHUSDT |
|---|---|---|
| Filas leídas | 27,719 (2023-01→2026-02) | 32,135 (2023-01→2026-08) |
| Filas insertadas | 27,719 | 32,135 |
| Duplicados | 0 | 0 |
| OHLC inválido | 0 | 0 |
| Filas saltadas | 0 | 0 |
| Formato epoch | mixto: 13 dígitos (ms, 2023-01→2024-12) → 16 dígitos (µs, 2025-01+), auto-detectado por `parseEpochDigits()` ya existente, sin cambios de código | igual |
| Gap real detectado | **1**: falta la vela `2023-03-24T13:00:00Z` (precedida por una vela genuina de volumen/trades = 0 en `12:00:00Z` — anomalía real de la fuente, no un artefacto de formato) | **el mismo gap**, mismo timestamp — confirmado independientemente en ambas fuentes |

El importador reutilizado (`importHistoricalMarketDataFromFile`, sin modificar) fue invocado en bucle sobre el directorio ordenado vía un nuevo script fino (`scripts/import-historical-market-data-batch.mjs`, ~30 líneas, ningún sistema paralelo) y reprodujo exactamente estos números.

### 1.4 Protección del benchmark de 6 meses (Condición 2)

Verificado antes E inmediatamente después de la importación completa (82 archivos), y de nuevo ahora al cerrar la fase: la fila `ResearchDataset` del benchmark original permanece **byte-idéntica** (mismo `id`, `rowCount=4416`, `datasetHash=8585b601...`, mismo rango de fechas) — nunca se recalculó, nunca se sobrescribió. El `@@unique(symbol, timeframe, startDate, endDate, source)` de `ResearchDataset` garantiza que un rango más amplio para el mismo símbolo crea una fila **independiente**, nunca toca la existente — comprobado con una prueba de integración nueva contra filas reales de MarketData/ResearchDataset (no solo razonamiento de schema).

### 1.5 Registro final — `ResearchDataset`

| Campo | BTC | ETH |
|---|---|---|
| rowCount | 32,135 | 32,135 |
| Rango | 2023-01-01T00:00Z → 2026-08-31T23:00Z | idéntico |
| coveragePct | 99.9969% | 99.9969% |
| gapCount | 1 (documentado, nunca rellenado) | 1 (mismo timestamp) |
| duplicateCount | 0 | 0 |
| datasetHash | `275eb78319cfe3a79487f8374dcacba3c9e1269ba26230a8381079f5fa1be870` | `71d64cdc26d0bf856335da05116bc24862798466ee903fd14fd88e31627906f5` |
| source | binance_csv | binance_csv |
| isDemo | false | false |

Cadena de provenance completa: RAW (ZIP en `data/raw/crypto/`) → MarketData (filas OHLCV con `source`/`realSources`) → `ResearchDataset` (hash + rowCount + rango) → `barsAsOf`/anti-lookahead ya existente → cada `runFamilyXDiscovery`/`Segment` reutiliza `getHistoricalBars(..., "HISTORICAL_REAL")`, la misma función que cualquier replay real del sistema.

**Alcance inicial respetado:** solo BTCUSDT H1 + ETHUSDT H1, sin resample a otros timeframes.

---

## 2. Partición IS / VALIDATION / OOS (congelada, Fase 13, sin redefinir)

| Segmento | Rango | Velas (por activo) |
|---|---|---|
| IS (Discovery) | 2023-01-01T00:00Z → 2025-03-14T09:00Z | 19,281 |
| VALIDATION | 2025-03-14T10:00Z → 2025-12-07T04:00Z | 6,427 |
| OOS | 2025-12-07T05:00Z → 2026-08-31T23:00Z | 6,427 |

Discovery se ejecutó **exclusivamente** sobre IS. La barrera estructural `tagAsIsOnly` (lanza `DiscoveryContaminationError`) se aplica dentro de cada `runFamilyXDiscovery` — no se puede invocar por error con bars de VALIDATION/OOS; verificado con 5 tests dedicados (uno por familia B-E + A) que confirman el throw.

---

## 3. Registro de hipótesis (resumen — ver `phase21HypothesisRegistry.ts` para el texto completo, escrito antes de ejecutar un solo cálculo sobre datos reales)

| ID | Nombre | Dirección esperada | Umbral/ventana |
|---|---|---|---|
| F21-A | Autocorrelación / persistencia | No direccional | lags [1,2,3,6,12,24]h, IC95% bootstrap bloques |
| F21-B | Momentum/reversión tras extremos | Continuación (+1) en extremo alcista, reversión (-1) en extremo bajista, por horizonte h∈{1,3,6,12,24} | percentil ≤10/≥90 sobre 500 obs |
| F21-C | Estructura de volatilidad | No direccional en el signo — se mide retorno y volatilidad futura | ATR percentil ≤20 (LOW) / ≥80 (HIGH) sobre 500 obs, horizontes 6/12/24h |
| F21-D | Precio + Volumen (ruptura confirmada/divergente) | +1 ruptura alcista, -1 bajista | lookback=20, volumeZ≥1.5σ confirmada, ratio<0.7 divergente |
| F21-E | Compresión→Expansión (coiling) | Continuación en dirección de ruptura | squeezeLookback=40, percentil≤20, minCoilLength=10 (idénticos a F17-A/F20-E) |
| F21-F | Regímenes (cruce transversal) | Hereda de A-E | n≥20 por celda, aplicado solo a buckets ya significativos de B-E |

---

## 4. Resultados de Discovery (IS, ambos activos) — tabla completa

`n` = tamaño de muestra; CI = IC95% bootstrap de bloques (blockSize=24h, seed=21, 5000 iteraciones); evidencia = `SIGNIFICANT_CONTINUATION` / `SIGNIFICANT_REVERSAL` / `NO_SIGNAL` / `INSUFFICIENT_SAMPLE`, clasificado por `classifySignalEvidence` con el signo esperado fijado en el pre-registro (nunca decidido después de ver el resultado).

### 4.1 F21-A — Autocorrelación (BTC y ETH, 6 lags)

| Lag (h) | BTC ρ observado | BTC ¿CI excluye 0? | ETH ρ observado | ETH ¿CI excluye 0? |
|---|---|---|---|---|
| 1 | -0.0225 | No | -0.0136 | No |
| 2 | 0.0066 | No | 0.0026 | No |
| 3 | -0.0019 | No | 0.0054 | No |
| 6 | 0.0015 | No | 0.0056 | No |
| 12 | 0.0027 | No | 0.0002 | No |
| 24 | -0.0210 | No | -0.0295 | No |

**Ningún lag, en ningún activo, muestra dependencia serial significativa.** Confirma, con ~3.5 años y un segundo activo, el resultado NEGATIVE de F20-A sobre 6 meses de solo BTC — no era un artefacto de muestra pequeña.

### 4.2 F21-B — Momentum/reversión tras extremos (10 buckets por activo)

| Bucket | BTC n | BTC mean | BTC evidencia | ETH n | ETH mean | ETH evidencia | ¿Replica cruzado? |
|---|---|---|---|---|---|---|---|
| h1_EXTREME_HIGH | 2010 | +0.00008 | NO_SIGNAL | 2010 | -0.00006 | NO_SIGNAL | — |
| **h1_EXTREME_LOW** | 2008 | **+0.00048** | **SIGNIFICANT_REVERSAL** | 2032 | **+0.00043** | **SIGNIFICANT_REVERSAL** | **SÍ** (único bucket de la familia) |
| h3_EXTREME_HIGH | 2001 | +0.00082 | SIGNIFICANT_CONTINUATION | 1998 | +0.00052 | NO_SIGNAL | No |
| h3_EXTREME_LOW | 2028 | +0.00069 | SIGNIFICANT_REVERSAL | 2044 | +0.00034 | NO_SIGNAL | No |
| h6_EXTREME_HIGH | 2030 | +0.00173 | SIGNIFICANT_CONTINUATION | 1986 | +0.00075 | NO_SIGNAL | No |
| h6_EXTREME_LOW | 2037 | +0.00093 | NO_SIGNAL | 2053 | +0.00024 | NO_SIGNAL | — |
| h12_EXTREME_HIGH | 2063 | +0.00315 | SIGNIFICANT_CONTINUATION | 1982 | +0.00151 | NO_SIGNAL | No |
| h12_EXTREME_LOW | 2044 | +0.00130 | NO_SIGNAL | 2118 | +0.00049 | NO_SIGNAL | — |
| h24_EXTREME_HIGH | 2052 | +0.00405 | NO_SIGNAL | 2072 | -0.00011 | NO_SIGNAL | — |
| h24_EXTREME_LOW | 2167 | +0.00417 | SIGNIFICANT_REVERSAL | 2183 | +0.00060 | NO_SIGNAL | No |

Solo `h1_EXTREME_LOW` replica en ambos activos con signo y magnitud consistentes (BTC +0.048%, ETH +0.043%, ambos CI positivos). Los otros 4 buckets significativos son específicos de BTC y no aparecen en ETH pese a tamaño de muestra adecuado (n>1900) — se tratan como hallazgos que **no generalizan**, no como evidencia débil.

### 4.3 F21-C — Estructura de volatilidad (6 buckets por activo)

| Bucket | BTC n | BTC mean | BTC evidencia | ETH n | ETH mean | ETH evidencia | ¿Replica cruzado? |
|---|---|---|---|---|---|---|---|
| h6_LOW_VOL | 3807 | +0.00007 | NO_SIGNAL | 4047 | +0.00044 | NO_SIGNAL | — |
| **h6_HIGH_VOL** | 4348 | **+0.00177** | **SIGNIFICANT_CONTINUATION** | 4299 | **+0.00180** | **SIGNIFICANT_CONTINUATION** | **SÍ** |
| h12_LOW_VOL | 3807 | +0.00041 | NO_SIGNAL | 4046 | +0.00051 | NO_SIGNAL | — |
| **h12_HIGH_VOL** | 4348 | **+0.00324** | **SIGNIFICANT_CONTINUATION** | 4299 | **+0.00293** | **SIGNIFICANT_CONTINUATION** | **SÍ** |
| h24_LOW_VOL | 3807 | +0.00018 | NO_SIGNAL | 4042 | -0.00022 | NO_SIGNAL | — |
| **h24_HIGH_VOL** | 4348 | **+0.00576** | **SIGNIFICANT_CONTINUATION** | 4299 | **+0.00404** | **SIGNIFICANT_CONTINUATION** | **SÍ** |

El estado HIGH_VOL predice retorno positivo en **los 3 horizontes, en ambos activos** — la consistencia cruzada más fuerte de toda la fase en IS. El cruce por régimen (Family F, sobre los eventos propios de cada bucket, ver §6) muestra el signo positivo presente en RANGE, HIGH_VOLATILITY y BULL para ambos activos — no es un artefacto de un único régimen. Pese a esto, **no sobrevive Validation/OOS** (§5).

### 4.4 F21-D — Precio + Volumen (12 buckets por activo)

| Bucket | BTC n | BTC mean | BTC evidencia | ETH n | ETH evidencia | ¿Replica? |
|---|---|---|---|---|---|---|
| h6_BREAKOUT_UP_CONFIRMED | 495 | +0.00241 | SIGNIFICANT_CONTINUATION | 478 | NO_SIGNAL | No |
| h12_BREAKOUT_UP_CONFIRMED | 495 | +0.00314 | SIGNIFICANT_CONTINUATION | 478 | NO_SIGNAL | No |
| h24_BREAKOUT_UP_CONFIRMED | 495 | +0.00508 | SIGNIFICANT_CONTINUATION | 478 | NO_SIGNAL | No |
| h24_BREAKOUT_DOWN_CONFIRMED | 431 | +0.00322 | SIGNIFICANT_REVERSAL (marginal, CI=[0.00001, 0.00683]) | 468 | NO_SIGNAL | No |
| Resto (DIVERGENT, n<30) | — | — | INSUFFICIENT_SAMPLE | — | INSUFFICIENT_SAMPLE | — |

Volumen usado: columna `volume` real de Binance (volumen base negociado, no proxy). Toda la aparente señal de BTC es específica de ese activo — ETH no muestra ningún bucket significativo en ninguno de los 12. No se declara edge.

### 4.5 F21-E — Compresión→Expansión (6 buckets por activo)

| Bucket | BTC n | BTC evidencia | ETH n | ETH mean | ETH evidencia | ¿Replica? |
|---|---|---|---|---|---|---|
| h6/h12/h24_SHORT_COIL | 986-1001 | NO_SIGNAL (ambos activos) | — | — | NO_SIGNAL | — |
| h6_LONG_COIL | 568 | NO_SIGNAL | 503 | -0.00134 | SIGNIFICANT_**REVERSAL** | No |
| h12_LONG_COIL | 568 | NO_SIGNAL | 503 | -0.00236 | SIGNIFICANT_**REVERSAL** | No |
| h24_LONG_COIL | 566 | NO_SIGNAL | 500 | -0.00344 | SIGNIFICANT_**REVERSAL** | No |

ETH muestra reversión significativa tras compresiones largas (`LONG_COIL`) en los 3 horizontes — pero en dirección **opuesta** a la hipótesis pre-registrada (que predecía continuación), y no replica en BTC. Se reporta tal cual, sin reformular la hipótesis a posteriori para "explicar" el hallazgo de ETH.

---

## 5. Validation + OOS de los 2 supervivientes de Discovery (Checkpoint 5)

Únicos candidatos que pasaron el filtro de Discovery (significativo en IS) **y** el filtro de consistencia cruzada BTC/ETH (mismo signo, ambos CI excluyen 0): F21-B `h1_EXTREME_LOW` y F21-C `HIGH_VOL` (h6/h12/h24). Se evaluaron con **exactamente las mismas fórmulas y umbrales congelados** (`runFamilyBSegment`/`runFamilyCSegment`, sin recalibrar nada), sobre VALIDATION (n≈620-650 y n≈1150-1520 según bucket) y OOS (n similar).

### 5.1 F21-B `h1_EXTREME_LOW`

| Activo | Segmento | n | mean | CI95% | Evidencia |
|---|---|---|---|---|---|
| BTC | VALIDATION | 645 | +0.00024 | [-0.00019, 0.00067] | NO_SIGNAL |
| BTC | OOS | 623 | +0.00009 | [-0.00033, 0.00058] | NO_SIGNAL |
| ETH | VALIDATION | 644 | +0.00001 | [-0.00069, 0.00069] | NO_SIGNAL |
| ETH | OOS | 611 | -0.00023 | [-0.00072, 0.00021] | NO_SIGNAL |

### 5.2 F21-C `HIGH_VOL` (h6/h12/h24)

| Activo | Segmento | h6 mean [CI] | h12 mean [CI] | h24 mean [CI] |
|---|---|---|---|---|
| BTC | VALIDATION | -0.00057 [-0.00196,0.00074] | -0.00061 [-0.00305,0.00163] | +0.00080 [-0.00365,0.00458] |
| BTC | OOS | +0.00082 [-0.00130,0.00263] | +0.00078 [-0.00315,0.00420] | -0.00100 [-0.00786,0.00555] |
| ETH | VALIDATION | +0.00187 [-0.00044,0.00441] | +0.00366 [-0.00055,0.00843] | +0.00657 [-0.00103,0.01496] |
| ETH | OOS | -0.00001 [-0.00265,0.00211] | -0.00102 [-0.00586,0.00270] | **-0.00556** [-0.01410,0.00210] |

Todas las 20 combinaciones (2 buckets × 2 activos × 2 segmentos, más los 3 horizontes de C) dan **NO_SIGNAL** — el CI vuelve a cruzar 0 en cuanto se sale del periodo de Discovery. El caso ETH `h24_HIGH_VOL` es el más ilustrativo: +0.657% en VALIDATION, -0.556% en OOS — inversión de signo entre segmentos consecutivos, exactamente el patrón de inestabilidad que la partición IS/VALIDATION/OOS está diseñada para exponer.

**Ninguno de los 2 candidatos avanza a Walk-Forward** (Checkpoint 5b): al no sobrevivir ni Validation ni OOS, aplicar walk-forward sobre una hipótesis ya rechazada no está justificado por el diseño de la fase (Condición 17 — no optimizar ni seguir investigando lo que ya se congeló como negativo; mismo criterio que F20-B, donde n=0/1 cerró el análisis sin walk-forward).

---

## 6. Family F — cruce por régimen (aplicado solo a buckets significativos de Discovery)

Se corrigió un bug encontrado durante el análisis: la primera versión del script de Family F cruzaba el régimen contra la serie **incondicional** de retornos futuros de cada horizonte (todos los bars), no contra los eventos reales de cada bucket — lo que hacía que buckets distintos con el mismo horizonte produjeran tablas idénticas. Se corrigió exponiendo `indices`/`values` por bucket en `BucketResult` y añadiendo `stratifyBucketByRegime`, con 4 tests nuevos que verifican que buckets con eventos distintos producen cruces distintos (commit `a19f82d`).

Con la corrección: el signo positivo de F21-C `HIGH_VOL` está presente en los regímenes con muestra adecuada (RANGE, HIGH_VOLATILITY, BULL) en **ambos** activos — no es un artefacto de un único régimen, aunque es más fuerte en BULL. Esto no cambia la conclusión de §5.2 (el hallazgo no sobrevive Validation/OOS de todas formas) — se documenta porque la comparación por régimen fue parte del pre-registro, no porque cambie la clasificación final.

---

## 7. Clasificación final — las 6 familias

| Familia | Clasificación | Evidencia de edge |
|---|---|---|
| F21-A (Autocorrelación) | **NEGATIVE / SIN EVIDENCIA** | No — ningún lag significativo, ningún activo. Confirma F20-A con 6x más muestra. |
| F21-B (Momentum/reversión) | **REJECTED tras Validation/OOS** | El único bucket que replicó en Discovery (`h1_EXTREME_LOW`, ambos activos) no sobrevive Validation ni OOS. Los demás buckets significativos no generalizan entre BTC/ETH. |
| F21-C (Volatilidad) | **REJECTED tras Validation/OOS** | `HIGH_VOL` es el hallazgo más consistente en IS (3 horizontes, ambos activos, robusto por régimen) pero no sobrevive Validation/OOS — incluye una inversión de signo en ETH OOS. |
| F21-D (Precio+Volumen) | **REJECTED — no generaliza** | Señal presente solo en BTC (3-4 buckets), ausente en ETH (0/12 buckets) pese a muestra adecuada. |
| F21-E (Compresión→Expansión) | **REJECTED — no generaliza, y en dirección opuesta a la hipótesis** | ETH muestra reversión (no continuación) tras `LONG_COIL`; BTC no muestra nada. |
| F21-F (Régimen, transversal) | No es una familia independiente — aplicada solo a candidatos ya rechazados en §5, sin cambiar su clasificación | — |

### ELIMINADAS (con razón)

- F21-A: sin evidencia en ningún lag/activo (confirmatorio, no ambiguo).
- F21-D: efecto real en BTC pero no generaliza a ETH con muestra adecuada — se elimina como hipótesis general, no se reporta como "supported en BTC".
- F21-E: efecto real en ETH pero en dirección contraria a la hipótesis, no generaliza a BTC.

### INCONCLUSAS

- Ninguna. Todas las 6 familias alcanzaron muestra suficiente para una clasificación definitiva en al menos IS; los 2 candidatos con evidencia de Discovery fueron llevados hasta Validation/OOS y resueltos como REJECTED, no dejados en ambigüedad.

### SUPPORTED / PROMETEDORAS

- **Ninguna.** F21-B `h1_EXTREME_LOW` y F21-C `HIGH_VOL` llegaron más lejos que el resto (Discovery + consistencia cruzada BTC/ETH) pero ninguno se declara "prometedor" — ambos fueron invalidados explícitamente por Validation/OOS, que es precisamente la razón de existir de esa etapa.

**0 de 6 hipótesis alcanzó siquiera WEAK_SUPPORT tras el pipeline completo.**

---

## 8. Lo que esta fase SÍ deja como conocimiento útil (Condición 21)

- Autocorrelación de retornos horarios: descartada con alta confianza en BTC y ETH, sobre 3.5 años — no vale la pena seguir investigando esta familia sobre este dataset.
- Ruptura confirmada por volumen (F21-D) y duración de compresión (F21-E): cualquier señal que parezca existir en un solo activo (BTC para D, ETH para E) es probablemente ruido específico de ese activo/periodo, no un efecto de mercado genuino — recordatorio concreto de por qué la comparación cruzada BTC/ETH (Condición 10) es indispensable antes de declarar nada.
- Estado de volatilidad alta (F21-C): el hallazgo más prometedor de la fase en IS (consistente en signo, horizonte y régimen entre BTC y ETH) y aun así no sobrevivió Validation/OOS — el ejemplo más claro de por qué la partición IS/VALIDATION/OOS existe: sin ella, este hallazgo se habría reportado como "supported" por error.

---

## 9. Validación técnica final

- **Tests:** 908/908 pasando (100 archivos de test), incluyendo los tests de Fase 21 (pre-registro, Discovery, EdgeStudy, DiscoveryRunner + la corrección de Family F) y todos los tests de Fases 1-20 sin regresiones.
- **Typecheck:** `npx tsc --noEmit` — limpio, 0 errores.
- **Lint:** `npx eslint src` — limpio, 0 errores/warnings.
- **Dataset hash BTC/ETH:** verificado sin cambios desde el registro (`275eb783...`, `71d64cdc...`).
- **Benchmark de 6 meses:** verificado byte-idéntico una última vez al cerrar la fase (`8585b601...`, rowCount=4416, misma fila `ResearchDataset`, nunca tocada).
- **Ejecución real:** Discovery y Validation/OOS ejecutados contra `dev.db` (datos reales importados, no sintéticos) vía `getHistoricalBars(..., "HISTORICAL_REAL")` — la misma función que usa cualquier replay real del sistema.

## 10. Qué NO se hizo (por diseño, según las 25 condiciones del brief)

- No se hizo grid search ni se probaron variantes/umbrales adicionales de ninguna familia tras ver resultados.
- No se recalibró ningún umbral con datos de VALIDATION/OOS.
- No se declaró F21-C ni F21-B "prometedoras" pese a ser, con diferencia, los hallazgos más consistentes de Discovery — la etapa de Validation/OOS existe exactamente para este caso y se respetó su veredicto.
- No se corrió Walk-Forward sobre hipótesis ya rechazadas en Validation/OOS.
- No se relajó ningún umbral de F21-D/F21-E al ver que no generalizaban a ambos activos.
- No se implementó ejecución real, cuentas reales, credenciales reales ni órdenes reales — todo permanece research/backtest/paper.

---

## DETENCIÓN

Fase 21 completa. **No se continúa automáticamente a ninguna fase posterior.** El siguiente paso se decide tras revisar estos resultados.
