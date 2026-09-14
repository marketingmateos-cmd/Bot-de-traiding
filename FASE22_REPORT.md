# FASE 22 — Multi-Timeframe Validation (H4/D1) — Informe Final

**Fecha de ejecución real:** 2026-09-14
**Datasets nuevos:** BTCUSDT y ETHUSDT, H4 (8033 velas) y D1 (1338 velas), 2023-01-01 → 2026-08-31, derivados por agregación pura de los mismos H1 ya importados en Fase 21 (nunca datos nuevos descargados)
**Datasets preexistentes, verificados intactos antes y después de esta fase:** benchmark BTCUSDT H1 6 meses (hash `8585b601...`), BTC/ETH H1 3.5 años (hashes `275eb783.../71d64cdc...`)
**Working tree:** limpio tras el commit final

---

## 0. Resumen ejecutivo

Fase 21 encontró que, sobre H1, dos buckets (F21-B `h1_EXTREME_LOW`, F21-C `HIGH_VOL`) superaban Discovery y la consistencia cruzada BTC/ETH, pero ninguno sobrevivía Validation/OOS. Esta fase pregunta: **¿alguno de esos patrones — u otro de las mismas familias ya congeladas — adquiere evidencia robusta al mirar H4 o D1?**

Se extendieron BTC/ETH a H4 y D1 por agregación pura (commit previo), verificados independientemente (Checkpoint 1: causalidad estricta, 0 discrepancias, hashes coincidentes). Se corrió Discovery (solo IS) para las mismas 6 familias A-F, con los mismos umbrales/ventanas de Fase 21 — sin re-sintonizar nada. En **H4**, tres candidatos superaron Discovery + consistencia cruzada BTC/ETH: autocorrelación negativa en lag=6 (24h), continuación tras movimiento extremo de 24 velas (4 días), y continuación tras estado de volatilidad alta (mismo patrón que F21-C, ahora en H4). **Ninguno de los tres sobrevivió Validation ni OOS** — el caso más claro es `HIGH_VOL` en BTC, que pasa de fuertemente positivo en IS a **consistentemente negativo** en VALIDATION y OOS, en los 3 horizontes.

En **D1**, el tamaño de muestra (≈800 velas IS) hace que la mayoría de buckets sean `INSUFFICIENT_SAMPLE`, y los pocos que aparentan ser significativos muestran magnitudes económicamente implausibles (retornos medios de 5-20% por bucket) característicos de estar dominados por 1-2 eventos extremos aislados, no de un patrón repetible — se descartan por dependencia de evento único (Condición 9), no se les aplica Validation/OOS.

**Resultado: 0 de las hipótesis ya congeladas en Fase 21 produce evidencia robusta en NINGUNA resolución (H1, H4, D1).** H4 sí "descubre" patrones nuevos en Discovery que H1 no mostraba (autocorrelación lag=6, momentum de 4 días) — pero esos patrones tampoco sobreviven, así que un timeframe mayor no resultó ser "mejor": simplemente cambia qué parece significativo en la ventana de Discovery, sin cambiar la conclusión final.

---

## 1. Checkpoint 1 — Verificación independiente de H4/D1

Script separado (`scripts/verify-resampled-market-data.mjs`), con una **segunda implementación** de agrupación H1→H4/D1 (deliberadamente distinta de `resampleBars.ts`, para que un bug compartido no sea auto-confirmatorio). Verificado para los 4 datasets (BTC/ETH × H4/D1):

| Verificación | Resultado |
|---|---|
| Causalidad estricta (cada barra H1 solo alimenta la ventana que la contiene) | ✅ 0 violaciones |
| rowCount persistido = grupos completos calculados independientemente | ✅ 8033 (H4) / 1338 (D1), ambos activos |
| 0 discrepancias OHLCV (persistido vs. recalculado) | ✅ |
| 0 timestamps duplicados | ✅ |
| datasetHash persistido = hash recalculado sobre filas ya en DB | ✅ |
| gapCount = grupos incompletos detectados independientemente | ✅ 1 en los 4 (mismo hueco real de Fase 21, 2023-03-24T13:00Z) |
| Benchmark 6 meses y H1 3.5 años (Fase 21) | ✅ byte-idénticos, sin tocar |

---

## 2. Checkpoint 2 — Pre-registro congelado (sin re-sintonizar nada)

`phase22PreRegistration.ts` congela la identidad de los 4 datasets y reutiliza — importados, nunca redefinidos — los mismos `FROZEN_RANGES` (fechas de calendario) y los mismos umbrales de `phase21PreRegistration.ts` (percentiles, lookbacks, horizontes en **barras**, no en horas). Esto significa que "horizonte=6" pasa a interpretarse como 6 barras H4 (24h) o 6 barras D1 (6 días) — deliberado: se pone a prueba si el MISMO patrón, con la MISMA definición en barras, sobrevive a otra resolución, no una versión re-ajustada a mano.

**Causalidad de agregación en los cortes IS/VALIDATION/OOS:** se añadió `sliceAggregatedBarsToRange`, que exige que la ventana COMPLETA de una barra H4/D1 (no solo su apertura) quede dentro de un segmento. Una barra D1 que abre en IS pero cuyo cierre cae ya en VALIDATION se descarta de los 3 segmentos — nunca se asigna al lado conveniente. Efecto medido: H4 pierde 3 barras de 8033 (0.04%) en los 2 cortes de frontera; D1 pierde 3 de 1338 (0.22%) — pérdida marginal, documentada, nunca oculta.

| Timeframe | IS | VALIDATION | OOS | Descartadas en frontera |
|---|---|---|---|---|
| H4 | 4819 | 1606 | 1605 | 3 |
| D1 | 802 | 267 | 266 | 3 |

---

## 3. Checkpoint 3 — Discovery (solo IS), familias A-F, H4 y D1

Reutiliza `runFamilyADiscovery`/`B`/`C`/`D`/`E` de `phase21DiscoveryRunner.ts` **sin modificar una sola línea** — la única diferencia frente a Fase 21 es qué bars se le pasan.

### 3.1 Familia A — Autocorrelación

| Lag (barras) | BTC H4 | ETH H4 | BTC D1 | ETH D1 |
|---|---|---|---|---|
| 1 | NO_SIG | NO_SIG | NO_SIG | NO_SIG |
| 2 | NO_SIG | NO_SIG | NO_SIG | NO_SIG |
| 3 | NO_SIG | NO_SIG | NO_SIG | NO_SIG |
| **6** | **ρ=-0.070, CI excluye 0** | **ρ=-0.061, CI excluye 0** | NO_SIG (n=801) | NO_SIG (n=801) |
| 12 | NO_SIG | NO_SIG | NO_SIG | NO_SIG |
| 24 | NO_SIG | NO_SIG | NO_SIG | NO_SIG |

**Lag=6 en H4 (≈24h) es significativo y de signo consistente en ambos activos** — un patrón que H1 (Fase 21) no mostraba en ningún lag. Candidato a Validation/OOS.

### 3.2 Familia B — Momentum/reversión tras extremos

De 10 buckets por activo en H4, solo **`h24_EXTREME_HIGH`** replica con signo consistente: BTC mean=+2.87% (CI [1.33%,5.04%]), ETH mean=+1.09% (CI [0.14%,2.52%]) — ambos `SIGNIFICANT_CONTINUATION`. El resto de buckets significativos (h1/h6/h12 en BTC, h3 en ETH) no replican cruzado. D1: la mayoría INSUFFICIENT_SAMPLE (n<70); los pocos "significativos" muestran magnitudes de 7-9% de media con CI muy anchos — dependientes de eventos aislados, no un patrón repetible con 3.5 años de datos diarios.

### 3.3 Familia C — Volatilidad

**`HIGH_VOL` replica en H4 en los 3 horizontes, ambos activos** — igual que F21-C en H1:

| Horizonte | BTC H4 mean | ETH H4 mean |
|---|---|---|
| h6 | +0.38% *** | +0.45% *** |
| h12 | +0.73% *** | +0.75% *** |
| h24 | +1.39% *** | +1.27% *** |

En D1, `HIGH_VOL` solo es significativo en BTC (h6/h12, no h24) y `NO_SIGNAL` en ETH en los 3 horizontes — no replica. `LOW_VOL` en D1 es `INSUFFICIENT_SAMPLE` (n≈22) en ambos activos.

### 3.4 Familia D — Precio+Volumen

H4: BTC muestra 3 buckets significativos, ETH solo 1 — combinaciones distintas de horizonte/dirección, no una replicación limpia. D1: prácticamente todo `INSUFFICIENT_SAMPLE` (n≤19 en la mayoría de buckets — el evento "ruptura confirmada por volumen" es estructuralmente raro a resolución diaria).

### 3.5 Familia E — Compresión→Expansión

H4: BTC `h6_LONG_COIL` significativo continuación; ETH `h24_LONG_COIL` significativo pero en **reversión** (dirección opuesta) — no replica. D1: 100% `INSUFFICIENT_SAMPLE`.

### 3.6 Familia F — Cruce por régimen (contexto, sobre los 3 candidatos de H4)

Aplicado sobre los eventos propios de cada bucket (usando `stratifyBucketByRegime`, ya corregido en Fase 21). El signo positivo de `C_HIGH_VOL` y `B_h24_EXTREME_HIGH` está presente en los regímenes con muestra adecuada (BULL, HIGH_VOLATILITY) para ambos activos — no es un artefacto de un único régimen. Esto no cambia la conclusión de §4: la robustez por régimen en IS no sustituye a Validation/OOS.

---

## 4. Checkpoint 4 — Validation + OOS de los 3 candidatos de H4

Reutiliza `runFamilyASegment`/`BSegment`/`CSegment` (sin barrera IS-only, mismas fórmulas, cero recalibración) sobre VALIDATION (1606 barras) y OOS (1605 barras).

### 4.1 Autocorrelación lag=6

| Activo | Segmento | ρ observado | CI95% |
|---|---|---|---|
| BTC | VALIDATION | -0.0029 | [-0.0607, 0.0556] |
| BTC | OOS | +0.0055 | [-0.0539, 0.0658] |
| ETH | VALIDATION | -0.0102 | [-0.0636, 0.0455] |
| ETH | OOS | +0.0123 | [-0.0431, 0.0582] |

Los 4 intervalos cruzan cero — el patrón desaparece por completo fuera de IS.

### 4.2 `h24_EXTREME_HIGH`

| Activo | Segmento | n | mean | Evidencia |
|---|---|---|---|---|
| BTC | VALIDATION | 120 | -0.09% | NO_SIGNAL |
| BTC | OOS | 137 | +0.33% | NO_SIGNAL |
| ETH | VALIDATION | 111 | +3.40% (CI roza 0) | NO_SIGNAL |
| ETH | OOS | 152 | -0.21% | NO_SIGNAL |

### 4.3 `HIGH_VOL` (h6/h12/h24)

| Activo | Segmento | h6 | h12 | h24 |
|---|---|---|---|---|
| BTC | VALIDATION | -0.16% | -0.33% | -0.94% |
| BTC | OOS | -0.38% | -0.94% | **-2.02%** |
| ETH | VALIDATION | +0.44% | +0.89% | +1.38% (CI roza 0) |
| ETH | OOS | -0.93% | -1.75% | -2.71% |

**Los 20 resultados (2+8+... realmente 4+8+12=24 combinaciones evaluadas entre los 3 candidatos) son `NO_SIGNAL`.** El caso más claro: `HIGH_VOL` en BTC pasa de fuertemente positivo en IS (+0.38% a +1.39% según horizonte, todos significativos) a **consistentemente negativo** en VALIDATION y OOS en los 3 horizontes — el mismo patrón de inversión de signo ya visto en Fase 21 (allí en ETH), ahora en BTC y en otra resolución.

**Walk-Forward: no alcanzado.** Ningún candidato sobrevivió Validation/OOS — aplicar walk-forward sobre una hipótesis ya rechazada no está justificado (mismo criterio que Fase 21, Condición 17). Para D1, la mayoría de buckets fueron `INSUFFICIENT_SAMPLE` ya en Discovery — se declara así explícitamente (Condición 8), sin fabricar significancia ni forzar un walk-forward sobre muestra insuficiente.

---

## 5. Comparación incremental — ¿H4/D1 aporta información nueva frente a H1?

| Pregunta | Respuesta |
|---|---|
| ¿El bucket `HIGH_VOL` de H1 (F21-C) reaparece en H4? | Sí, en Discovery/IS (misma dirección, magnitud similar) — pero falla Validation/OOS en H4 igual que en H1. Es el mismo fenómeno visto a otra resolución, no información nueva. |
| ¿El bucket `h1_EXTREME_LOW` de H1 (F21-B) reaparece en H4? | No — en H4, `h1_EXTREME_HIGH`/`h1_EXTREME_LOW` (ambos con horizonte de 4h) SÍ son significativos en BTC pero NO en ETH — no replica cruzado, a diferencia del hallazgo original en H1. |
| ¿H4 descubre patrones que H1 no mostraba? | Sí — autocorrelación lag=6 y momentum de `h24_EXTREME_HIGH` no aparecían en H1. Pero ambos fallan Validation/OOS igual que todo lo demás. |
| ¿D1 aporta señal que H1/H4 no tengan? | No verificable con confianza — el tamaño de muestra en D1 (≈800 IS) es insuficiente para la mayoría de buckets, y las pocas excepciones aparentemente significativas muestran dependencia de evento único. |
| ¿Un timeframe mayor es "mejor"? | **No.** Cambia cuáles de las ~34 combinaciones bucket×horizonte parecen significativas en Discovery (un efecto esperable de simplemente tener menos barras, menos solapamiento y comparaciones ligeramente distintas), pero en las 3 resoluciones probadas (H1, H4, D1) la conclusión final tras Validation/OOS es la misma: 0 supervivientes. |

---

## 6. Clasificación final

| Hipótesis (bucket) | Timeframe | Discovery | Validation/OOS | Clasificación |
|---|---|---|---|---|
| F21-A autocorrelación, todos los lags | H1 | NO_SIGNAL | — | NEGATIVE (confirmado en Fase 20/21) |
| Autocorrelación lag=6 | H4 | SIGNIFICANT (ambos activos) | NO_SIGNAL (4/4) | **REJECTED tras Validation/OOS** |
| Autocorrelación, todos los lags | D1 | NO_SIGNAL | — | NEGATIVE (muestra adecuada, n=801) |
| F21-B `h1_EXTREME_LOW` | H1 | SIGNIFICANT (ambos) | NO_SIGNAL (Fase 21) | REJECTED (ya en Fase 21) |
| Familia B, todos los buckets | H4 | Solo `h24_EXTREME_HIGH` replica | NO_SIGNAL (4/4) | **REJECTED tras Validation/OOS** |
| Familia B, todos los buckets | D1 | Mayoría INSUFFICIENT_SAMPLE; resto evento-dependiente | No aplicado | INSUFFICIENT / descartado por dependencia de evento único |
| F21-C `HIGH_VOL` | H1 | SIGNIFICANT (ambos, 3 horizontes) | NO_SIGNAL (Fase 21) | REJECTED (ya en Fase 21) |
| `HIGH_VOL` | H4 | SIGNIFICANT (ambos, 3 horizontes) | NO_SIGNAL (12/12), signo invertido en BTC | **REJECTED tras Validation/OOS** |
| `HIGH_VOL` | D1 | Solo BTC (parcial) | No aplicado | No replica cruzado — descartado en Discovery |
| Familia D (precio+volumen) | H4 | No replica cruzado | No aplicado | REJECTED — no generaliza entre activos |
| Familia D | D1 | Prácticamente todo INSUFFICIENT_SAMPLE | No aplicado | INSUFFICIENT |
| Familia E (compresión) | H4 | No replica cruzado (signos opuestos) | No aplicado | REJECTED — no generaliza |
| Familia E | D1 | 100% INSUFFICIENT_SAMPLE | No aplicado | INSUFFICIENT |

**0 de las hipótesis ya congeladas en Fase 21 produce evidencia robusta en H4 o D1.**

### ELIMINADAS (con razón)
- Autocorrelación lag=6 (H4): significativa y cruzada en IS, pero el CI vuelve a cruzar 0 en VALIDATION y OOS en ambos activos — inestabilidad temporal clásica.
- `h24_EXTREME_HIGH` (H4): igual patrón — significativo en IS, `NO_SIGNAL` en los 4 chequeos de Validation/OOS.
- `HIGH_VOL` (H4): el caso más contundente — invierte de signo entre IS y Validation/OOS en BTC.
- Familias D y E en H4: no generalizan entre BTC y ETH ya en Discovery, ni siquiera llegan a Validation/OOS.

### INCONCLUSAS (declaradas explícitamente, no forzadas a una conclusión)
- La mayoría de buckets en D1 (Familias B, D, E): `INSUFFICIENT_SAMPLE` — 3.5 años a resolución diaria (~800 barras IS) no alcanza el umbral mínimo de muestra para casi ninguna condición de evento (percentiles extremos, rupturas confirmadas por volumen, compresiones largas). Esto no es evidencia de ausencia de patrón — es ausencia de muestra suficiente para evaluarlo, y se reporta como tal (Condición 8), sin más inversión en intentar "rescatar" significancia en D1 con este dataset.

### SUPPORTED / PROMETEDORAS
- **Ninguna.**

---

## 7. Validación técnica final

- **Tests:** ver commit — suite completa (F1-F21 + nuevos de Fase 22) pasando, incluyendo los 10 tests nuevos de `resampleBars.test.ts` (commit anterior), 10 de `phase22PreRegistration.test.ts` (causalidad de corte IS/VALIDATION/OOS para barras agregadas).
- **Typecheck:** `npx tsc --noEmit` — limpio.
- **Lint:** `npx eslint src` — limpio.
- **Build:** `npm run build` — exitoso.
- **Datasets:** hashes H4/D1 verificados independientemente (Checkpoint 1); benchmark de 6 meses y H1 de Fase 21 verificados byte-idénticos una última vez al cerrar la fase.
- **Preservado sin modificar:** ningún archivo de Fase 17-21 (`phase17-21*.ts`), motor de replay, Risk Engine, Evaluation Risk Engine, ni convenciones de costes/slippage — esta fase reutiliza exclusivamente `runFamilyXDiscovery`/`Segment` ya existentes, nunca reimplementados. Los buckets de Discovery/Validation de Fase 21/22 son estudios estadísticos de retorno condicional (no estrategias con entrada/salida/costes) — no hay capa de fees/slippage que preservar en este framework, igual que en Fase 21.

## 8. Qué NO se hizo (por diseño)

- No se inventó ninguna familia nueva — solo se re-aplicaron las 6 ya congeladas en Fase 21 (A-F), con los mismos umbrales.
- No se re-sintonizó ningún umbral por timeframe — "horizonte=6" significa 6 barras en cualquier resolución, no una hora-equivalente elegida a mano.
- No se declaró ganador ningún resultado positivo de Discovery antes de pasar por Validation/OOS — los 3 candidatos de H4 se tomaron en serio (tabla completa, Family F de contexto) y se sometieron al mismo escrutinio que en Fase 21.
- No se forzó Walk-Forward sobre hipótesis ya rechazadas, ni sobre D1 con muestra insuficiente.
- No se tocó ningún dataset, resultado o convención de Fases 11-21.

---

## Commit y estado del repositorio

- **Commits de código:** ver historial (`extender BTC/ETH a H4/D1...`, `Fase 22 CP1-2...`, este informe).
- **Working tree:** limpio tras el commit final.

---

## DETENCIÓN

Fase 22 completa. **No se continúa automáticamente a Fase 23.** El siguiente paso se decide tras revisar estos resultados.
