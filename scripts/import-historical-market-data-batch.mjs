/**
 * Fase 21 — CLI para importar un DIRECTORIO de CSVs históricos REALES hacia
 * `MarketData` en una sola invocación, reutilizando exactamente el mismo
 * `importHistoricalMarketDataFromFile` que `import-historical-market-data-from-file.mjs`
 * usa para un único archivo — esto NO es un segundo sistema de importación
 * paralelo, es ese mismo importador aplicado en bucle a cada archivo del
 * directorio, en orden de nombre (que para el patrón `SYMBOL-Ntf-YYYY-MM.csv`
 * coincide con orden cronológico).
 *
 * Uso:
 *   npx tsx scripts/import-historical-market-data-batch.mjs \
 *     --dir /tmp/f21-extracted/BTCUSDT --symbol BTCUSDT --timeframe H1 --source binance_csv
 */
const importerModule = await import("../src/lib/marketData/offlineImporter.ts");
const importHistoricalMarketDataFromFile = importerModule.importHistoricalMarketDataFromFile ?? importerModule.default?.importHistoricalMarketDataFromFile;

const { readdirSync } = await import("node:fs");
const { join } = await import("node:path");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      out[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function usageAndExit(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Uso: npx tsx scripts/import-historical-market-data-batch.mjs --dir <directorio> --symbol BTCUSDT --timeframe H1 --source binance_csv");
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || !args.symbol || !args.timeframe || !args.source) {
    usageAndExit("faltan argumentos requeridos (--dir, --symbol, --timeframe, --source)");
  }

  const files = readdirSync(args.dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();
  if (files.length === 0) usageAndExit(`no se encontró ningún .csv en ${args.dir}`);

  const results = [];
  for (const file of files) {
    const filePath = join(args.dir, file);
    const stats = await importHistoricalMarketDataFromFile({
      filePath,
      exchangeSymbol: args.symbol,
      timeframe: args.timeframe,
      source: args.source,
    });
    results.push({ file, ...stats });
    console.log(
      `${file}: rowsRead=${stats.rowsRead} valid=${stats.rowsValid} inserted=${stats.inserted} updated=${stats.updated} duplicates=${stats.duplicates} skipped=${stats.skipped} invalid=${stats.invalid} status=${stats.status}${stats.error ? " ERROR=" + stats.error : ""}`
    );
  }

  const totals = results.reduce(
    (acc, r) => ({
      rowsRead: acc.rowsRead + r.rowsRead,
      rowsValid: acc.rowsValid + r.rowsValid,
      inserted: acc.inserted + r.inserted,
      updated: acc.updated + r.updated,
      duplicates: acc.duplicates + r.duplicates,
      skipped: acc.skipped + r.skipped,
      invalid: acc.invalid + r.invalid,
    }),
    { rowsRead: 0, rowsValid: 0, inserted: 0, updated: 0, duplicates: 0, skipped: 0, invalid: 0 }
  );
  console.log();
  console.log(`TOTAL (${files.length} archivos): rowsRead=${totals.rowsRead} valid=${totals.rowsValid} inserted=${totals.inserted} updated=${totals.updated} duplicates=${totals.duplicates} skipped=${totals.skipped} invalid=${totals.invalid}`);

  const failed = results.filter((r) => r.status !== "DONE" && r.status !== "PARTIAL");
  if (failed.length > 0) {
    console.log(`ARCHIVOS FALLIDOS: ${failed.map((r) => r.file).join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const dbModule = await import("../src/lib/db.ts");
    const prisma = dbModule.prisma ?? dbModule.default?.prisma;
    await prisma.$disconnect();
  });
