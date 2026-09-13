/**
 * Fase 9.1 — CLI para importar velas históricas REALES desde un archivo
 * CSV local hacia `MarketData`, como segunda vía junto a
 * `scripts/import-historical-market-data.mjs` (Binance API en vivo).
 *
 * Formato CSV esperado (cabecera obligatoria, en este orden exacto):
 *   timestamp,open,high,low,close,volume
 * `timestamp` acepta ISO-8601 o epoch en milisegundos (13 dígitos) /
 * segundos (10 dígitos). Cualquier otro formato se rechaza explícitamente
 * en vez de adivinarse.
 *
 * Uso:
 *   npm run market-data:import:file -- --file ./data/btcusdt-1h.csv --symbol BTCUSDT --timeframe H1 --source binance_csv
 *
 * `--source` es obligatorio y NUNCA puede ser "binance" (reservado para
 * la ruta de la API en vivo) — así un archivo jamás puede hacerse pasar
 * por datos que en realidad vinieron de la API.
 */
// Resolved defensively (not a plain named import): a .mjs entry importing
// a tsx-compiled .ts module can collapse named exports under `default`
// (see import-historical-market-data.mjs for the full explanation).
const importerModule = await import("../src/lib/marketData/offlineImporter.ts");
const importHistoricalMarketDataFromFile = importerModule.importHistoricalMarketDataFromFile ?? importerModule.default?.importHistoricalMarketDataFromFile;

const coverageModule = await import("../src/lib/marketData/coverage.ts");
const computeMarketDataCoverage = coverageModule.computeMarketDataCoverage ?? coverageModule.default?.computeMarketDataCoverage;

const symbolMappingModule = await import("../src/lib/marketData/symbolMapping.ts");
const resolveInternalSymbol = symbolMappingModule.resolveInternalSymbol ?? symbolMappingModule.default?.resolveInternalSymbol;

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
  console.error("Uso: npm run market-data:import:file -- --file <ruta.csv> --symbol BTCUSDT --timeframe H1 --source binance_csv [--start YYYY-MM-DD] [--end YYYY-MM-DD]");
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.symbol || !args.timeframe || !args.source) {
    usageAndExit("faltan argumentos requeridos (--file, --symbol, --timeframe, --source)");
  }

  let startDate;
  let endDate;
  if (args.start) {
    startDate = new Date(args.start);
    if (Number.isNaN(startDate.getTime())) usageAndExit(`--start inválido: "${args.start}"`);
  }
  if (args.end) {
    endDate = new Date(args.end);
    if (Number.isNaN(endDate.getTime())) usageAndExit(`--end inválido: "${args.end}"`);
  }

  console.log(`Archivo:    ${args.file}`);
  console.log(`Símbolo:    ${args.symbol}`);
  console.log(`Timeframe:  ${args.timeframe}`);
  console.log(`Source:     ${args.source}`);
  if (startDate) console.log(`Desde:      ${startDate.toISOString()}`);
  if (endDate) console.log(`Hasta:      ${endDate.toISOString()}`);
  console.log();

  const stats = await importHistoricalMarketDataFromFile({
    filePath: args.file,
    exchangeSymbol: args.symbol,
    timeframe: args.timeframe,
    source: args.source,
    startDate,
    endDate,
  });

  console.log(`Filas leídas:     ${stats.rowsRead}`);
  console.log(`Filas válidas:    ${stats.rowsValid}`);
  console.log(`Insertadas:       ${stats.inserted}`);
  console.log(`Actualizadas:     ${stats.updated}`);
  console.log(`Duplicadas:       ${stats.duplicates}`);
  console.log(`Descartadas:      ${stats.skipped} (fuera de rango)`);
  console.log(`Inválidas:        ${stats.invalid}`);
  console.log(`Primera vela:     ${stats.firstTimestamp ? stats.firstTimestamp.toISOString() : "—"}`);
  console.log(`Última vela:      ${stats.lastTimestamp ? stats.lastTimestamp.toISOString() : "—"}`);
  if (stats.error) console.log(`Error:            ${stats.error}`);
  console.log(`Resultado:        ${stats.status}`);
  console.log(`Import log id:    ${stats.importLogId}`);

  if (stats.status === "DONE" || stats.status === "PARTIAL") {
    const internalSymbol = resolveInternalSymbol(args.symbol).internalSymbol;
    const coverage = await computeMarketDataCoverage(internalSymbol, args.timeframe, args.source);
    console.log();
    console.log(`--- Cobertura MarketData: ${coverage.symbol} @ ${coverage.timeframe} (${coverage.source}) ---`);
    console.log(`  Velas:      ${coverage.rowCount}`);
    console.log(`  Cobertura:  ${coverage.coveragePct !== null ? coverage.coveragePct.toFixed(2) + "%" : "—"}`);
    console.log(`  Huecos:     ${coverage.gaps.length}`);
    for (const gap of coverage.gaps) {
      console.log(`    - ${gap.missingCandles} vela(s) faltante(s) entre ${gap.afterTimestamp} y ${gap.beforeTimestamp}`);
    }
  }

  if (stats.status !== "DONE") process.exitCode = 1;
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
