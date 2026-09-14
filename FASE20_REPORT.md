# FASE 20 — Nuevas Fuentes de Edge — Informe Final

**Fecha de ejecución real:** 2026-09-14
**Dataset:** BTCUSDT H1, 2026-03-01 → 2026-08-31 (4416 velas)
**Dataset hash (verificado antes Y después de la ejecución):** `8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503` ✅ intacto
**9 estrategias originales (Fase 11/17):** verificadas sin modificación (mismos `defaultParams`, mismos `ReplayRun` DONE con 3 segmentos cada uno) ✅
**Commit:** `5cda6cd` (código) + este informe en un commit posterior
**Working tree:** limpio tras el commit final

---

## 0. Resumen ejecutivo

Las 5 familias de la Fase 20 fueron pre-registradas, implementadas con la barrera estructural Discovery/Validation, ejecutadas realmente contra el dataset BTCUSDT congelado, y evaluadas con el mismo rigor (IS/VALIDATION/OOS + walk-forward + Monte Carlo/stress) que las 9 estrategias de Fase 11/17. **Ninguna de las 5 familias produjo evidencia de edge.** F20-A no muestra autocorrelación estadísticamente significativa en ningún lag. F20-B, F20-C y F20-E fueron clasificadas **NEGATIVE** (retorno ≤ 0 en IS, VALIDATION y OOS de forma consistente). F20-D no detecta ningún efecto de sesión: las tasas de acierto por sesión (ASIA/LONDON/NY), agregadas sobre las 9 estrategias existentes, son prácticamente idénticas (37.4%–38.0%).

Este resultado es coherente con — y refuerza — el patrón ya observado en Fase 18 (9/9 estrategias NEGATIVE) y Fase 19 (23/27 segmentos NEGATIVE_ROBUST, 0 ROBUST): sobre este dataset y este universo de hipótesis, no se ha encontrado ninguna fuente de edge que sobreviva IS→VALIDATION→OOS.

---

## 1. F20-A — Return Autocorrelation Structure (estudio estadístico puro)

**Diseño:** ACF estándar (media/varianza global fija) sobre log-retornos horarios, evaluada en los 6 lags congelados (1, 2, 3, 6, 12, 24 horas), con IC 95% por block-bootstrap (seed=20, blockSize=24, 5000 iteraciones). Discovery ejecutado exclusivamente sobre bars IS (barrera estructural `tagAsIsOnly`, que lanza `DiscoveryContaminationError` si se le pasa un solo bar posterior a `FROZEN_RANGES.is.end`).

| Lag (h) | IS ρ(k) | IS IC95% | VALIDATION ρ(k) | VALIDATION IC95% | OOS ρ(k) | OOS IC95% | WF signo estable |
|---|---|---|---|---|---|---|---|
| 1  | 0.0062  | [-0.047, 0.057] | -0.0745 | [-0.186, 0.068] | 0.0107  | [-0.085, 0.108] | 67% (3 ventanas) |
| 2  | -0.0431 | [-0.089, 0.010] | -0.0052 | [-0.077, 0.074] | -0.0053 | [-0.066, 0.048] | 33% |
| 3  | -0.0168 | [-0.060, 0.031] | -0.0105 | [-0.119, 0.081] | -0.0193 | [-0.116, 0.075] | 100% |
| 6  | 0.0184  | [-0.028, 0.051] | 0.0268  | [-0.053, 0.090] | -0.0310 | [-0.112, 0.061] | 33% |
| 12 | 0.0093  | [-0.038, 0.046] | 0.0388  | [-0.050, 0.091] | 0.0409  | [-0.044, 0.089] | 100% |
| 24 | -0.0515 | [-0.038, 0.038] | 0.0326  | [-0.064, 0.062] | 0.0797  | [-0.062, 0.066] | 0% |

**Muestra:** n=2649 (IS), n=882 (VALIDATION), n=882 (OOS).

**Interpretación:** en **todos** los lags y **todos** los segmentos, el intervalo de confianza al 95% cruza cero — no hay evidencia estadística de dependencia serial en los retornos horarios de BTCUSDT en este periodo. La estabilidad de signo en walk-forward es errática (0%–100% según el lag, sin un patrón coherente con lo que se esperaría de una dependencia real), consistente con ruido.

**Clasificación:** **NEGATIVE / SIN EVIDENCIA.** Por diseño (Condición 4), esto NO se convierte automáticamente en una estrategia — no hay una hipótesis de trading formal que evaluar más allá de "no hay estructura de autocorrelación detectable".

**Limitaciones:** un solo dataset de 6 meses; los IC de bootstrap por bloques son razonablemente amplios dado el tamaño de muestra por segmento (n~900 en VALIDATION/OOS).

---

## 2. F20-B — Volatility Regime Transition Shock

**Hipótesis:** una transición LOW_VOLATILITY → HIGH_VOLATILITY (vía el Regime Engine ya existente) en una ventana corta (`transitionWindowBars=3`) puede predecir continuación en la dirección del movimiento neto de precio durante esa ventana.

**Datos:** BTCUSDT H1, dataset congelado. **Fórmula:** ver `research20/volatilityTransitionShock.ts`. **Muestra:** IS=0 trades, VALIDATION=0 trades, OOS=1 trade — la condición (régimen LOW_VOLATILITY seguido de HIGH_VOLATILITY en solo 3 velas) es estructuralmente rara en este dataset.

| Segmento | Trades | Return% | PF | Expectancy | Avg R | Median R | MaxDD% |
|---|---|---|---|---|---|---|---|
| IS | 0 | 0.00 | — | 0.00 | — | — | 0.00 |
| VALIDATION | 0 | 0.00 | — | 0.00 | — | — | 0.00 |
| OOS | 1 | -0.12 | — | -21.58 | -1.09 | -1.09 | 0.12 |

**Walk-Forward:** 3 ventanas, avgReturn=-0.04%, winRate ventanas=0%.
**Monte Carlo/stress:** solo evaluable en OOS (n=1) — resultado único (no hay resampleo significativo posible con n=1); return -0.11% a -0.12% (BASE→stress máximo).
**Costes/slippage:** fees=2.18, slippage=1.60 en el único trade OOS.

**Clasificación:** **NEGATIVE** — "Retorno ≤ 0 en IS, VALIDATION y OOS — evidencia consistente de comportamiento desfavorable en las 3 particiones" (aplicado aquí de forma literal: 0/0/negativo).

**Comparación incremental:** no aplica — la evidencia no alcanza el umbral mínimo (Condición 8) para justificar una comparación, y la muestra es estructuralmente insuficiente (n=1) para cualquier conclusión.

**Interpretación:** la hipótesis en sí (transición de régimen como señal) no pudo ponerse a prueba de forma significativa en este dataset — la condición de entrada es demasiado restrictiva (solo se disparó 1 vez en 6 meses). Esto no es evidencia de que la hipótesis sea falsa; es evidencia de que el dataset/periodo no ofrece suficientes transiciones de este tipo para evaluarla. **No se relaja el umbral retroactivamente** (Condición 14).

---

## 3. F20-C — Volume-Price Divergence

**Hipótesis:** un nuevo extremo de precio (máximo/mínimo de 20 velas) hecho con volumen anormalmente bajo (ratio < 0.7 respecto a la media de las 20 velas previas) señala una divergencia precio/volumen que precede a una reversión.

| Segmento | Trades | Return% | PF | Expectancy | Avg R | Median R | MaxDD% | Long/Short |
|---|---|---|---|---|---|---|---|---|
| IS | 21 | -1.24 | 0.28 | -9.68 | -0.54 | -1.11 | 1.29 | 14/7 |
| VALIDATION | 9 | -0.43 | 0.33 | -7.41 | -0.44 | -1.14 | 0.43 | 7/2 |
| OOS | 6 | -0.31 | 0.17 | -9.56 | -0.27 | -0.51 | 0.37 | 4/2 |

**Costes:** fees totales IS=44.70/VAL=19.05/OOS=12.25; slippage IS=39.61/VAL=17.71/OOS=10.58.
**Walk-Forward:** 3 ventanas, avgReturn=-0.31%, winRate ventanas=0%.
**Monte Carlo (BASE, mediana de retorno):** IS=-1.04% (p5=-1.59%, p95=-0.39%), VALIDATION=-0.34% (p5=-0.66%, p95=+0.02%), OOS=-0.29% (p5=-0.57%, p95=-0.01%). Bajo el escenario de stress más pesado (fees+50%/slippage+50%): IS=-1.25%, VALIDATION=-0.43%, OOS=-0.34% — el signo negativo es robusto al stress de costes.

**Clasificación:** **NEGATIVE** — retorno negativo, PF < 1, y expectancy negativa en las 3 particiones de forma consistente.

**Comparación incremental:** no aplica (evidencia no alcanza WEAK_SUPPORT).

**Interpretación:** la divergencia precio/volumen tal como está definida no muestra ventaja — de hecho, el profit factor es sistemáticamente bajo (0.17–0.33), sugiriendo que operar la reversión en estas condiciones pierde consistentemente, no solo por costes. Los intervalos de Monte Carlo en OOS/VALIDATION casi rozan el 0% en el percentil 95, pero la mediana es negativa en las 3 particiones.

---

## 4. F20-D — Session / Time-of-Day Structural Effect (descriptivo)

**Diseño:** análisis puramente descriptivo (nunca formalizado como estrategia, `F20D_FORMALIZE_AS_STRATEGY=false`) sobre los trades YA producidos por Fase 18 para las 9 estrategias existentes, bucketizados por sesión de entrada (ASIA 00-08h UTC, LONDON 08-16h UTC, NY 13-21h UTC — solapamiento LONDON/NY es convención estándar de mercado, no post-hoc).

### 4.1 Desglose por estrategia (segmento OOS)

| Estrategia | Trades OOS | ASIA (n / WR / PnL) | LONDON (n / WR / PnL) | NY (n / WR / PnL) |
|---|---|---|---|---|
| breakout-baseline-v1 | 54 | 11 / 55% / +31* | 28 / 46% / -22 | 28 / 43% / -99 |
| momentum-baseline-v1 | 28 | 8 / 50% / -8* | 12 / 50% / -7* | 12 / 50% / +18* |
| mean-reversion-baseline-v1 | 74 | 17 / 24% / -142* | 43 / 26% / -315 | 33 / 36% / -169 |
| trend-following-baseline-v1 | 117 | 29 / 17% / -267 | 50 / 40% / -292 | 50 / 38% / -141 |
| research-volatility-squeeze-v1 | 20 | 4 / 25% / -39* | 12 / 50% / -45* | 9 / 22% / -65* |
| research-volume-confirmation-v1 | 29 | 6 / 17% / -64* | 17 / 41% / -122* | 15 / 27% / -136* |
| research-trend-pullback-v1 | 53 | 11 / 55% / -21* | 23 / 52% / -72 | 23 / 65% / +87 |
| research-breakout-confirmation-v1 | 29 | 6 / 50% / -9* | 19 / 58% / +41* | 15 / 53% / +15* |
| research-momentum-reversal-v1 | 11 | 3 / 0% / -69* | 3 / 67% / +22* | 4 / 50% / -33* |

`*` = muestra insuficiente (n < MIN_SAMPLE_SIZE=20). WR=win rate. PnL en USD.

### 4.2 Agregado — las 9 estrategias × las 3 particiones (IS+VALIDATION+OOS), por sesión

| Sesión | n total | Win rate | PnL total |
|---|---|---|---|
| ASIA | 532 | 37.8% | -2512 |
| LONDON | 1002 | 37.4% | -5807 |
| NY | 973 | 38.0% | -5113 |

**Clasificación:** **SIN EVIDENCIA** de efecto de sesión — el umbral exigido (Condición 6) era SUPPORTED, el más alto de la jerarquía, precisamente por el riesgo de comparaciones múltiples entre 3 buckets. Las tasas de acierto agregadas difieren en menos de 1 punto porcentual entre sesiones — indistinguible de ruido. Ninguna sesión individual, aun mirando estrategia por estrategia, muestra una ventaja consistente y sostenida con muestra suficiente.

**Interpretación:** no se encontró una "hora ganadora", ni se buscó retrospectivamente una (Condición 6 — no se testearon las 24 horas individuales, no se probaron particiones alternativas). El hallazgo honesto es: sobre este dataset, la sesión de entrada no parece ser una fuente de edge diferenciada.

---

## 5. F20-E — Compression Duration ("Coiling Length")

**Hipótesis:** una ruptura tras una compresión de volatilidad que ha durado ≥10 velas consecutivas (`minCoilLength`) tiene más continuidad que una ruptura tras una compresión de duración no controlada (F17-A solo exige el estado de la vela inmediatamente anterior). `squeezeLookback=40`/`squeezePercentile=20` son IDÉNTICOS a F17-A, reutilizados sin re-elegir, para que la comparación de novedad sea limpia (Condición 7).

| Segmento | Trades | Return% | PF | Expectancy | Avg R | Median R | MaxDD% | Long/Short |
|---|---|---|---|---|---|---|---|---|
| IS | 32 | -1.06 | 0.49 | -4.49 | -0.39 | -1.13 | 1.13 | 18/14 |
| VALIDATION | 12 | -0.42 | 0.30 | -4.81 | -0.28 | -0.38 | 0.45 | 10/2 |
| OOS | 12 | -0.49 | 0.16 | -5.95 | -0.56 | -1.10 | 0.51 | 4/8 |

**Costes:** fees totales IS=68.44/VAL=25.34/OOS=26.38; slippage IS=56.79/VAL=22.49/OOS=22.92.
**Walk-Forward:** 3 ventanas, avgReturn=-0.38%, winRate ventanas=0%.
**Monte Carlo (BASE, mediana):** IS=-0.73% (p5=-1.32%, p95=-0.10%), VALIDATION=-0.29% (p5=-0.55%, p95=-0.01%), OOS=-0.36% (p5=-0.59%, p95=-0.13%). Bajo stress máximo: IS=-1.05%, VALIDATION=-0.41%, OOS=-0.48% — negativo en todo el rango percentil 5-95 en OOS incluso bajo BASE.

**Clasificación:** **NEGATIVE**.

**Comparación de novedad vs F17-A (Condición 7 — obligatoria independientemente del resultado):**

| Métrica | Valor |
|---|---|
| Correlación de P&L diario (OOS) vs research-volatility-squeeze-v1 | 0.563 |
| Solapamiento temporal de operaciones (OOS) | 100% |
| Clasificación | `INSUFICIENTE_MUESTRA` (OOS de ambas estrategias < MIN_SAMPLE_SIZE=20) |

**Interpretación:** F20-E y F17-A SÍ comparten una correlación moderada-alta (0.56) y un solapamiento temporal total en OOS — consistente con que ambas están, en efecto, capturando una versión del mismo fenómeno de ruptura-tras-compresión (F20-E es un subconjunto más exigente de las señales de F17-A, ya que exige coilLength≥10 además de la condición de F17-A). Sin embargo, la muestra OOS de ambas (12 y menos de 20 respectivamente) es demasiado pequeña para que esta comparación sea concluyente en ningún sentido — ni para declarar redundancia total ni para descartarla. **No se declara novedad simplemente porque la fórmula es distinta** (Condición 7): la evidencia disponible sugiere que, de haber señal, sería la MISMA señal que F17-A vista con más restricciones, no una fuente de edge independiente — pero esto queda como hallazgo tentativo, no una conclusión firme, dado el tamaño de muestra.

---

## 6. Clasificación honesta de las 5 hipótesis

| Familia | Clasificación | Evidencia de edge |
|---|---|---|
| F20-A (Autocorrelación) | NEGATIVE / SIN EVIDENCIA | No — ningún lag es significativo en ningún segmento |
| F20-B (Transición de volatilidad) | NEGATIVE | No — muestra casi nula (n=1 en OOS), pero lo poco que hay es negativo |
| F20-C (Divergencia volumen-precio) | NEGATIVE | No — PF<1 y retorno negativo consistente en las 3 particiones |
| F20-D (Efecto de sesión) | SIN EVIDENCIA | No — diferencias entre sesiones indistinguibles de ruido |
| F20-E (Duración de compresión) | NEGATIVE | No — y probablemente redundante con F17-A (correlación 0.56, solapamiento 100%), aunque la muestra no permite confirmarlo con certeza |

**0 de 5 hipótesis alcanzó siquiera WEAK_SUPPORT.** Ninguna fue ocultada, ninguna fue seleccionada por conveniencia — se reportan las 5, incluyendo la más débil (F20-B, con solo 1 trade en OOS).

---

## 7. Validación técnica final

- **Tests:** 850/850 pasando (96 archivos de test), incluyendo 75+ tests nuevos de Fase 20 (autocorrelación, sesión, compresión, barrera Discovery, comparación incremental, análisis de sesión, integridad, las 3 nuevas estrategias vía el motor de replay real).
- **Typecheck:** `npx tsc --noEmit` — limpio, 0 errores.
- **Lint:** `npx eslint src` — limpio, 0 errores/warnings.
- **Build:** `npm run build` — ver resultado en el commit final.
- **Dataset hash:** verificado idéntico antes y después de la ejecución real (`8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503`).
- **9 estrategias originales:** verificadas sin cambios (mismos `defaultParams`, mismos `ReplayRun` con status DONE y 3 `ReplayResult` cada uno, sin re-ejecución).
- **Ejecución real:** endpoint `/api/phase20-validation` ejecutado contra `dev.db` (dataset real, no sintético), HTTP 200, ~7.4 minutos de ejecución.

## 8. Qué NO se hizo (por diseño, según las 15 condiciones)

- No se optimizó ningún parámetro tras ver resultados.
- No se hizo grid search ni se probaron variantes adicionales de ninguna familia.
- No se relajó el umbral de F20-D (SUPPORTED) al ver que no se alcanzaba.
- No se declaró F20-E "novedosa" solo por tener una fórmula distinta a F17-A.
- No se convirtió F20-A en estrategia de trading.
- No se implementó ejecución real, cuentas reales, credenciales reales ni órdenes reales — todo permanece research/backtest/paper/demo.

---

## Commit y estado del repositorio

- **Commit de código:** `5cda6cd` — "Fase 20 (en progreso): infraestructura completa de las 5 familias de edge"
- **Este informe** se añade en un commit posterior tras la validación final.
- **Working tree:** limpio tras el commit.

---

## DETENCIÓN

Fase 20 completa. **No se continúa automáticamente a Fase 21.** Se requiere una nueva especificación/autorización explícita antes de implementar cualquier fase posterior.
