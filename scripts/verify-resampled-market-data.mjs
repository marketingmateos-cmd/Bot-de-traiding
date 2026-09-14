/**
 * Fase 22 Checkpoint 1 — auditoría INDEPENDIENTE del resample H1->H4/D1 ya
 * persistido (Fase "extender BTC/ETH a H4/D1"). Deliberadamente NO reutiliza
 * el propio script de resample (`resample-market-data.mjs`) para calcular
 * nada — vuelve a leer H1 desde cero, vuelve a agrupar a mano (una
 * implementación de agrupación DISTINTA de `resampleH1Bars`, para que un
 * bug en `resampleH1Bars` no sea auto-confirmatorio), y compara contra lo
 * persistido en MarketData + lo registrado en ResearchDataset.
 *
 * Verifica: causalidad estricta (cada barra H1 solo puede alimentar la
 * barra agregada cuya ventana la contiene, nunca una futura ni una
 * pasada), OHLCV correcto, ausencia de duplicados, gapCount, y que los
 * hashes coinciden entre lo persistido y lo registrado.
 *
 * Uso: npx tsx scripts/verify-resampled-market-data.mjs
 */
const dbModule = await import("../src/lib/db.ts");
const prisma = dbModule.prisma ?? dbModule.default?.prisma;
const { computeDatasetHash } = await import("../src/lib/research/researchDataset.ts");

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DERIVED_SOURCE = "binance_csv_resampled_h1";
const H1_SOURCE = "binance_csv";

/** Segunda implementación de agrupación, deliberadamente independiente de resampleBars.ts. */
function independentGroup(h1Rows, target) {
  const sizeMs = target === "H4" ? 4 * HOUR_MS : DAY_MS;
  const groups = new Map();
  for (const row of h1Rows) {
    const t = row.timestamp.getTime();
    const bucketStart = Math.floor(t / sizeMs) * sizeMs;
    if (!groups.has(bucketStart)) groups.set(bucketStart, []);
    groups.get(bucketStart).push(row);
  }
  return groups;
}

let anyFailure = false;
function assertTrue(cond, message) {
  if (!cond) {
    console.error(`FALLO: ${message}`);
    anyFailure = true;
  } else {
    console.log(`OK: ${message}`);
  }
}

async function verifySymbolTarget(symbol, target) {
  console.log(`\n=== ${symbol} ${target} ===`);
  const asset = await prisma.asset.findUnique({ where: { symbol } });
  const h1Rows = await prisma.marketData.findMany({
    where: { assetId: asset.id, timeframe: "H1", source: H1_SOURCE, isDemo: false },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
  });

  const groups = independentGroup(h1Rows, target);
  const expectedCount = target === "H4" ? 4 : 24;
  const sizeMs = target === "H4" ? 4 * HOUR_MS : DAY_MS;

  let completeGroups = 0;
  let incompleteGroups = 0;
  const expectedBars = [];
  for (const [bucketStart, rows] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
    // Causalidad estricta: CADA fila de este grupo debe caer dentro de [bucketStart, bucketStart+sizeMs) — nunca antes, nunca después.
    for (const r of rows) {
      const t = r.timestamp.getTime();
      if (t < bucketStart || t >= bucketStart + sizeMs) {
        assertTrue(false, `causalidad violada: fila ${r.timestamp.toISOString()} asignada al grupo ${new Date(bucketStart).toISOString()} pero está fuera de su ventana`);
      }
    }
    if (rows.length !== expectedCount) {
      incompleteGroups++;
      continue;
    }
    const sorted = rows.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    // Contigüidad: ninguna hora interna del grupo puede faltar (un grupo con 4/24 filas pero con huecos internos y duplicados en otro punto sería un falso positivo de "completo").
    let contiguous = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime() !== HOUR_MS) contiguous = false;
    }
    if (!contiguous) {
      incompleteGroups++;
      continue;
    }
    completeGroups++;
    expectedBars.push({
      timestamp: new Date(bucketStart),
      open: sorted[0].open,
      high: Math.max(...sorted.map((r) => r.high)),
      low: Math.min(...sorted.map((r) => r.low)),
      close: sorted[sorted.length - 1].close,
      volume: sorted.reduce((s, r) => s + r.volume, 0),
    });
  }

  console.log(`  grupos completos=${completeGroups} incompletos=${incompleteGroups}`);

  const persisted = await prisma.marketData.findMany({
    where: { assetId: asset.id, timeframe: target, source: DERIVED_SOURCE },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
  });

  assertTrue(persisted.length === expectedBars.length, `rowCount persistido (${persisted.length}) coincide con grupos completos calculados independientemente (${expectedBars.length})`);

  const REL_EPSILON = 1e-9;
  const closeEnough = (a, b) => a === b || Math.abs(a - b) <= Math.abs(a) * REL_EPSILON;
  let mismatches = 0;
  for (let i = 0; i < Math.min(persisted.length, expectedBars.length); i++) {
    const p = persisted[i];
    const e = expectedBars[i];
    if (p.timestamp.getTime() !== e.timestamp.getTime() || !closeEnough(p.open, e.open) || !closeEnough(p.high, e.high) || !closeEnough(p.low, e.low) || !closeEnough(p.close, e.close) || !closeEnough(p.volume, e.volume)) {
      mismatches++;
      if (mismatches <= 3) console.error(`  MISMATCH en índice ${i}: persisted=${JSON.stringify(p)} expected=${JSON.stringify(e)}`);
    }
  }
  assertTrue(mismatches === 0, `0 discrepancias OHLCV entre lo persistido y la agrupación independiente (encontradas: ${mismatches})`);

  // Duplicados: el propio @@unique de MarketData ya lo impide a nivel de DB, pero lo confirmamos contando timestamps distintos.
  const distinctTimestamps = new Set(persisted.map((r) => r.timestamp.getTime()));
  assertTrue(distinctTimestamps.size === persisted.length, `sin timestamps duplicados en MarketData (${persisted.length} filas, ${distinctTimestamps.size} timestamps distintos)`);

  const dataset = await prisma.researchDataset.findFirst({ where: { symbol, timeframe: target, source: DERIVED_SOURCE } });
  assertTrue(dataset !== null, `ResearchDataset registrado para ${symbol} ${target}`);
  if (dataset) {
    assertTrue(dataset.rowCount === persisted.length, `ResearchDataset.rowCount (${dataset.rowCount}) coincide con filas persistidas (${persisted.length})`);
    const persistedHash = computeDatasetHash(persisted);
    assertTrue(dataset.datasetHash === persistedHash, `ResearchDataset.datasetHash coincide con el hash recalculado sobre las filas persistidas (independiente de registerResearchDataset)`);
    assertTrue(dataset.gapCount === incompleteGroups, `ResearchDataset.gapCount (${dataset.gapCount}) coincide con grupos incompletos detectados independientemente (${incompleteGroups})`);
  }
}

async function verifyUntouchedOriginals() {
  console.log("\n=== Verificando que H1 y el benchmark de 6 meses siguen intactos ===");
  const btcDatasets = await prisma.researchDataset.findMany({ where: { symbol: "BTC", timeframe: "H1" }, orderBy: { createdAt: "asc" } });
  const benchmark = btcDatasets.find((d) => d.rowCount === 4416);
  const wideH1 = btcDatasets.find((d) => d.rowCount === 32135);
  assertTrue(benchmark?.datasetHash === "8585b601d39c8a79bc06ea1617d7663dc86fa3111584752fbb5fd9286e943503", "benchmark BTCUSDT H1 6 meses: hash byte-idéntico");
  assertTrue(wideH1?.datasetHash === "275eb78319cfe3a79487f8374dcacba3c9e1269ba26230a8381079f5fa1be870", "dataset BTC H1 3.5 años (Fase 21): hash byte-idéntico");
  const ethWideH1 = await prisma.researchDataset.findFirst({ where: { symbol: "ETH", timeframe: "H1", rowCount: 32135 } });
  assertTrue(ethWideH1?.datasetHash === "71d64cdc26d0bf856335da05116bc24862798466ee903fd14fd88e31627906f5", "dataset ETH H1 3.5 años (Fase 21): hash byte-idéntico");
}

async function main() {
  await verifyUntouchedOriginals();
  for (const symbol of ["BTC", "ETH"]) {
    for (const target of ["H4", "D1"]) {
      await verifySymbolTarget(symbol, target);
    }
  }
  console.log(anyFailure ? "\n=== RESULTADO: FALLÓ AL MENOS UNA VERIFICACIÓN ===" : "\n=== RESULTADO: TODAS LAS VERIFICACIONES PASARON ===");
  if (anyFailure) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
