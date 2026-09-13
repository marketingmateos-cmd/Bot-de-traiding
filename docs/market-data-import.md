# Importar datos históricos REALES a `MarketData`

Este proyecto sigue siendo exclusivamente **paper trading / research**. Ninguno de estos
importadores usa API keys, ninguno envía órdenes, y ambos leen exclusivamente de fuentes públicas
de solo lectura.

Hay dos vías, y **ambas terminan en la misma tabla** (`MarketData`, con `source` explícito e
`isDemo: false`):

```
Binance API pública  ──▶ scripts/import-historical-market-data.mjs        ─┐
                                                                            ├──▶ MarketData
CSV local (REAL)     ──▶ scripts/import-historical-market-data-from-file.mjs ─┘
```

## 1. Vía API (Binance en vivo)

```bash
npm run market-data:import -- --symbol=BTCUSDT,ETHUSDT,SOLUSDT --timeframe=H1 --start=2024-01-01 --end=2024-01-31
```

Requiere que este entorno tenga salida de red hacia `api.binance.com`. En el sandbox de
desarrollo de este proyecto esa salida está bloqueada por política de red (confirmado: `403 Host
not in allowlist`) — en un entorno con acceso a internet normal, esto funciona sin cambios.

## 2. Vía CSV local (funciona en cualquier entorno, incluido este sandbox)

### Formato esperado

Cabecera obligatoria, columnas en este orden exacto:

```csv
timestamp,open,high,low,close,volume
2023-06-01T00:00:00Z,26000,26050,25980,26020,120.5
2023-06-01T01:00:00Z,26020,26100,26000,26080,98.2
```

- `timestamp`: ISO-8601 (`2023-06-01T00:00:00Z`) **o** epoch numérico de exactamente 13 dígitos
  (milisegundos) o 10 dígitos (segundos). Cualquier otra longitud de dígitos, o un formato de texto
  no reconocido, se **rechaza explícitamente** — nunca se adivina si un número es segundos o
  milisegundos.
- `open,high,low,close,volume`: números. `high >= low`, `high >= open`, `high >= close`,
  `low <= open`, `low <= close`; toda violación se rechaza y esa vela nunca se persiste.
- No hace falta pre-ordenar el archivo: el importador ordena por timestamp antes de validar.
- Duplicados exactos de timestamp dentro del mismo archivo se detectan y solo se conserva una fila.

### Obtener un CSV real

Cualquier exportación de velas OHLCV de un exchange o proveedor de datos que puedas convertir a
este formato de 6 columnas sirve. Ejemplos habituales: exportar velas históricas desde el panel de
un exchange, o convertir un dataset descargado previamente (p. ej. un dump de `klines` de Binance
guardado en otro entorno con acceso a internet) a este CSV.

### Ejecutar la importación

```bash
npm run market-data:import:file -- \
  --file ./data/btcusdt-1h.csv \
  --symbol BTCUSDT \
  --timeframe H1 \
  --source binance_csv
```

- `--symbol` es el símbolo del EXCHANGE (p. ej. `BTCUSDT`), no el símbolo interno — se mapea
  explícitamente a `BTC`/`ETH`/`SOL` vía `src/lib/marketData/symbolMapping.ts`. Un símbolo sin
  mapeo explícito (p. ej. `DOGEUSDT`) falla en vez de adivinar.
- `--source` es **obligatorio** y **nunca puede ser `"binance"`** — esa etiqueta está reservada
  para la vía de la API en vivo. Usa algo explícito como `binance_csv`, `binance_csv_backfill`, etc.
  Así, ninguna fila de un CSV puede hacerse pasar por datos que en realidad vinieron de la API.
- `--start`/`--end` (opcionales): si se indican, cualquier vela del archivo fuera de ese rango se
  descarta (nunca se inserta).
- Es idempotente: volver a importar el mismo archivo (o uno solapado) nunca crea filas duplicadas
  — la segunda ejecución reporta esas filas como "duplicadas".

La salida imprime archivo, símbolo, timeframe, filas leídas/válidas/insertadas/duplicadas/huecos y
el rango temporal final.

## 3. Comprobar cobertura

```bash
npm run market-data:coverage -- --symbol=BTC,ETH,SOL --timeframe=H1
```

Muestra, por activo: número de velas, primera/última fecha, % de cobertura y cada hueco real
detectado (nunca se rellenan huecos sintéticamente — un hueco reportado es un hueco real en los
datos importados hasta ese momento).

## 4. Verificar que los datos están marcados como REALES (`isDemo=false`)

Ninguno de los dos importadores acepta `isDemo` como parámetro — cada fila que escriben lleva
`isDemo: false` de forma incondicional. Para confirmarlo directamente en la base de datos:

```bash
npx tsx -e "
import('./src/lib/db.ts').then(async (m) => {
  const prisma = m.prisma ?? m.default?.prisma;
  const rows = await prisma.marketData.findMany({ where: { source: 'binance_csv' }, take: 3 });
  console.log(rows.map(r => ({ timestamp: r.timestamp, source: r.source, isDemo: r.isDemo })));
  await prisma.\$disconnect();
});
"
```

## 5. Ejecutar un Historical Replay REAL

Una vez importado al menos un rango de velas para un activo/timeframe:

1. Ir a **Research → Historical Replay** (`/replay`) en la UI.
2. Elegir el mismo activo/timeframe/rango que importaste.
3. En "Fuente de datos", elegir `HISTORICAL_REAL`.
4. Ejecutar. Si el rango pedido no tiene datos importados, el replay falla honestamente con
   `HISTORICAL DATA UNAVAILABLE` — nunca cae en modo sintético en silencio.
5. Con datos disponibles, los resultados muestran la insignia **"HISTORICAL REAL (Binance)"** (no
   "SYNTHETIC"), junto con la tabla de cobertura por activo (cobertura %, velas, primera/última
   fecha, huecos, calidad) — ver `src/components/replay/HistoricalReplayForm.tsx`.

**Importante**: un resultado de replay, real o sintético, es una prueba de infraestructura y de
integridad de datos — nunca evidencia por sí sola de que una estrategia sea rentable.
