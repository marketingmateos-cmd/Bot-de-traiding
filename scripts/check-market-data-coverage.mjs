/**
 * Fase 9.6 — reporta la cobertura REAL de `MarketData` para uno o más
 * símbolos: primera vela, última vela, número de velas y huecos reales
 * (nunca rellenados). Solo lectura, no llama a ninguna API externa.
 *
 * Uso:
 *   npx tsx scripts/check-market-data-coverage.mjs --symbol=BTC,ETH,SOL --timeframe=H1
 */
// See import-historical-market-data.mjs for why this resolves defensively
// instead of a plain named import (a .mjs entry importing a tsx-compiled
// .ts module can collapse named exports under `default`).
const coverageModule = await import("../src/lib/marketData/coverage.ts");
const computeMarketDataCoverage = coverageModule.computeMarketDataCoverage ?? coverageModule.default?.computeMarketDataCoverage;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) continue;
    out[match[1]] = match[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.symbol || !args.timeframe) {
    console.error("Uso: npx tsx scripts/check-market-data-coverage.mjs --symbol=BTC,ETH,SOL --timeframe=H1");
    process.exit(1);
  }
  const symbols = args.symbol.split(",").map((s) => s.trim()).filter(Boolean);
  // Omit entirely (rather than defaulting to "binance") when --source isn't
  // given: computeMarketDataCoverage then reports across every real source
  // found, matching what the replay pipeline itself actually reads.
  const source = args.source;

  for (const symbol of symbols) {
    const report = await computeMarketDataCoverage(symbol, args.timeframe, source);
    console.log(`--- ${report.symbol} @ ${report.timeframe} (${report.sources.length > 0 ? report.sources.join(", ") : "sin datos"}) ---`);
    console.log(`  rows:        ${report.rowCount}`);
    console.log(`  first:       ${report.firstTimestamp ?? "—"}`);
    console.log(`  last:        ${report.lastTimestamp ?? "—"}`);
    console.log(`  coverage:    ${report.coveragePct !== null ? report.coveragePct.toFixed(2) + "%" : "—"}`);
    console.log(`  gaps:        ${report.gaps.length}`);
    for (const gap of report.gaps) {
      console.log(`    - ${gap.missingCandles} vela(s) faltante(s) entre ${gap.afterTimestamp} y ${gap.beforeTimestamp}`);
    }
    console.log();
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
