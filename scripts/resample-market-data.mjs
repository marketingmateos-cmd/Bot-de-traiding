/**
 * Extiende el dataset H1 ya importado (BTC/ETH, Fase 21) a H4/D1 por
 * agregación pura — reutiliza `resampleH1Bars` (src/lib/marketData/resampleBars.ts)
 * sin reimplementar nada, y persiste el resultado como filas `MarketData`
 * nuevas bajo un `source` explícitamente distinto ("binance_csv_resampled_h1")
 * para que quede claro en todo momento que son velas DERIVADAS, nunca
 * confundidas con velas H1 crudas de Binance. Nunca rellena huecos: un
 * grupo de 4/24 horas que no está completo (el hueco real ya documentado
 * en 2023-03-24T13:00Z) se salta, nunca se agrega parcialmente.
 *
 * Uso: npx tsx scripts/resample-market-data.mjs --symbol BTC --source binance_csv
 */
const dbModule = await import("../src/lib/db.ts");
const prisma = dbModule.prisma ?? dbModule.default?.prisma;
const { resampleH1Bars } = await import("../src/lib/marketData/resampleBars.ts");
const { registerResearchDataset, computeDatasetHash } = await import("../src/lib/research/researchDataset.ts");

const RESAMPLED_SOURCE_SUFFIX = "_resampled_h1";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else {
      out[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function resampleAndPersist(symbol, sourceH1) {
  const asset = await prisma.asset.findUnique({ where: { symbol } });
  if (!asset) throw new Error(`No existe Asset con symbol "${symbol}".`);

  const h1Rows = await prisma.marketData.findMany({
    where: { assetId: asset.id, timeframe: "H1", source: sourceH1, isDemo: false },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
  });
  if (h1Rows.length === 0) throw new Error(`No hay velas H1 (source=${sourceH1}) para ${symbol}.`);
  console.log(`${symbol}: ${h1Rows.length} velas H1 fuente (${h1Rows[0].timestamp.toISOString()} -> ${h1Rows[h1Rows.length - 1].timestamp.toISOString()})`);

  const derivedSource = `${sourceH1}${RESAMPLED_SOURCE_SUFFIX}`;
  const report = {};

  for (const target of ["H4", "D1"]) {
    const { bars, incompleteGroupsSkipped } = resampleH1Bars(h1Rows, target);
    console.log(`  ${symbol} -> ${target}: ${bars.length} velas agregadas, ${incompleteGroupsSkipped} grupo(s) incompleto(s) saltado(s) (nunca rellenados)`);

    const existing = await prisma.marketData.findMany({
      where: { assetId: asset.id, timeframe: target, source: derivedSource },
      select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
    });
    // SQLite's REAL storage introduces ~1 ULP of rounding on a summed float
    // (confirmed at the bit level: aggregating 4/24 volumes in JS then
    // reading the persisted value back can differ in the last significant
    // digit) — an accepted, harmless characteristic of float storage, not a
    // data error. Compared with strict !== this would make EVERY row look
    // "changed" on every re-run (breaking the idempotency this pipeline
    // already relies on elsewhere — Fase 16). A relative epsilon far above
    // float64 precision but far below any real price/volume change avoids that.
    const REL_EPSILON = 1e-9;
    const closeEnough = (a, b) => a === b || Math.abs(a - b) <= Math.abs(a) * REL_EPSILON;
    const existingByTs = new Map(existing.map((r) => [r.timestamp.getTime(), r]));
    const toInsert = bars.filter((b) => {
      const e = existingByTs.get(b.timestamp.getTime());
      return !e || !closeEnough(e.open, b.open) || !closeEnough(e.high, b.high) || !closeEnough(e.low, b.low) || !closeEnough(e.close, b.close) || !closeEnough(e.volume, b.volume);
    });

    const CHUNK = 2000;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      // upsert one by one only for the (expected-rare) changed rows; the common first-run case is all-new -> createMany
      const brandNew = chunk.filter((b) => !existingByTs.has(b.timestamp.getTime()));
      const changed = chunk.filter((b) => existingByTs.has(b.timestamp.getTime()));
      if (brandNew.length > 0) {
        await prisma.marketData.createMany({
          data: brandNew.map((b) => ({ assetId: asset.id, timeframe: target, timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, source: derivedSource, isDemo: false, quality: 100 })),
        });
      }
      for (const b of changed) {
        await prisma.marketData.update({
          where: { assetId_timeframe_timestamp_source: { assetId: asset.id, timeframe: target, timestamp: b.timestamp, source: derivedSource } },
          data: { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, isDemo: false, quality: 100 },
        });
      }
    }

    const dataset = bars.length > 0 ? await registerResearchDataset({ symbol, timeframe: target, startDate: bars[0].timestamp, endDate: bars[bars.length - 1].timestamp, source: derivedSource }) : null;

    // Auditoría independiente: re-lee las filas YA PERSISTIDAS con una query
    // separada (no reutiliza `bars`, que son floats crudos pre-persistencia
    // — SQLite introduce un redondeo de ~1 ULP al sumar 4/24 floats para
    // `volume`, confirmado a nivel de bits; comparar eso contra lo persistido
    // daría un falso positivo de "no coincide" sin que exista ningún bug real)
    // y recalcula el hash con la MISMA función que usa `registerResearchDataset`
    // pero en un segundo camino de código independiente — si esto no coincide
    // con `dataset.datasetHash`, sí hay un bug real en la persistencia/registro.
    const rowCountCheck = bars.length > 0 ? await prisma.marketData.count({ where: { assetId: asset.id, timeframe: target, source: derivedSource, timestamp: { gte: bars[0].timestamp, lte: bars[bars.length - 1].timestamp } } }) : 0;
    const persistedRows = bars.length > 0 ? await prisma.marketData.findMany({ where: { assetId: asset.id, timeframe: target, source: derivedSource, timestamp: { gte: bars[0].timestamp, lte: bars[bars.length - 1].timestamp } }, orderBy: { timestamp: "asc" }, select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true } }) : [];
    const independentHash = computeDatasetHash(persistedRows);

    report[target] = { barsAggregated: bars.length, incompleteGroupsSkipped, inserted: toInsert.length, rowCountCheck, independentHash, registeredHash: dataset?.datasetHash ?? null, hashMatches: dataset ? dataset.datasetHash === independentHash : null, rowCountMatches: dataset ? rowCountCheck === dataset.rowCount : null, researchDatasetId: dataset?.id ?? null };
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = args.symbol ? [args.symbol] : ["BTC", "ETH"];
  const source = args.source ?? "binance_csv";

  const allReports = {};
  for (const symbol of symbols) {
    allReports[symbol] = await resampleAndPersist(symbol, source);
  }

  console.log("\n=== RESUMEN ===");
  for (const [symbol, byTarget] of Object.entries(allReports)) {
    for (const [target, r] of Object.entries(byTarget)) {
      console.log(`${symbol} ${target}: ${r.barsAggregated} velas, ${r.incompleteGroupsSkipped} grupos saltados, hash independiente=${r.hashMatches ? "COINCIDE" : "NO COINCIDE"} (${r.registeredHash})`);
      if (!r.hashMatches) {
        console.error(`ERROR: hash independiente no coincide para ${symbol} ${target} — DETENIENDO, no se confía en este dataset.`);
        process.exitCode = 1;
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
