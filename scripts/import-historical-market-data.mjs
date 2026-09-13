/**
 * Fase 9 — CLI para importar velas históricas REALES de Binance (público,
 * sin API key, sin envío de órdenes) hacia `MarketData`.
 *
 * Uso:
 *   npx tsx scripts/import-historical-market-data.mjs --symbol=BTCUSDT --timeframe=H1 --start=2023-01-01 --end=2023-01-31
 *   npx tsx scripts/import-historical-market-data.mjs --symbol=BTCUSDT,ETHUSDT,SOLUSDT --timeframe=H1 --start=2023-01-01 --end=2023-01-31
 *
 * Deliberadamente NO descarga nada por sí solo si se ejecuta sin argumentos
 * — exige --symbol/--timeframe/--start/--end explícitos, para que jamás
 * ocurra una descarga masiva accidental (p. ej. desde un test o un import).
 */
// Resolved defensively (not a plain named import): when this native ESM
// (.mjs) entry point imports a .ts module that tsx compiles to CommonJS
// (this repo's package.json has no "type": "module"), Node's own
// CJS/ESM interop occasionally collapses every named export under
// `default` instead of exposing them individually — a well-known
// interop edge case, not a bug in importer.ts (confirmed: the same
// module's named export resolves fine when imported from another .ts
// file run directly by tsx). Handling both shapes keeps this script
// correct either way.
const importerModule = await import("../src/lib/marketData/importer.ts");
const importHistoricalMarketData = importerModule.importHistoricalMarketData ?? importerModule.default?.importHistoricalMarketData;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) continue;
    out[match[1]] = match[2];
  }
  return out;
}

function usageAndExit(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    "Uso: npx tsx scripts/import-historical-market-data.mjs --symbol=BTCUSDT[,ETHUSDT,...] --timeframe=H1 --start=YYYY-MM-DD --end=YYYY-MM-DD"
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.symbol || !args.timeframe || !args.start || !args.end) {
    usageAndExit("faltan argumentos requeridos (--symbol, --timeframe, --start, --end)");
  }

  const startDate = new Date(args.start);
  const endDate = new Date(args.end);
  if (Number.isNaN(startDate.getTime())) usageAndExit(`--start inválido: "${args.start}"`);
  if (Number.isNaN(endDate.getTime())) usageAndExit(`--end inválido: "${args.end}"`);
  if (startDate.getTime() > endDate.getTime()) usageAndExit("--start debe ser <= --end");

  const symbols = args.symbol
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Importando ${symbols.join(", ")} @ ${args.timeframe} desde ${startDate.toISOString()} hasta ${endDate.toISOString()}`);
  console.log("Fuente: Binance API pública (sin API key, sin envío de órdenes). Solo lectura.\n");

  let anyFailed = false;

  for (const exchangeSymbol of symbols) {
    console.log(`--- ${exchangeSymbol} ---`);
    try {
      const stats = await importHistoricalMarketData({
        exchangeSymbol,
        timeframe: args.timeframe,
        startDate,
        endDate,
      });
      console.log(`  status:      ${stats.status}`);
      console.log(`  requested:   ${stats.requested}`);
      console.log(`  received:    ${stats.received}`);
      console.log(`  inserted:    ${stats.inserted}`);
      console.log(`  updated:     ${stats.updated}`);
      console.log(`  duplicates:  ${stats.duplicates}`);
      console.log(`  skipped:     ${stats.skipped}`);
      console.log(`  invalid:     ${stats.invalid}`);
      console.log(`  first:       ${stats.firstTimestamp ? stats.firstTimestamp.toISOString() : "—"}`);
      console.log(`  last:        ${stats.lastTimestamp ? stats.lastTimestamp.toISOString() : "—"}`);
      if (stats.error) console.log(`  error:       ${stats.error}`);
      console.log(`  importLogId: ${stats.importLogId}`);
      if (stats.status !== "DONE") anyFailed = true;
    } catch (err) {
      anyFailed = true;
      console.error(`  FALLÓ: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }

  if (anyFailed) process.exitCode = 1;
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
