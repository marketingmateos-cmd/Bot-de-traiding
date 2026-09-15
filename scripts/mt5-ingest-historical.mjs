/**
 * MT5 DEMO READ-ONLY DATA CONNECTOR — CLI de ingestión histórica.
 *
 * Reutiliza el mismo TradingExecutionAdapter singleton
 * (getMt5ExecutionAdapter, src/lib/execution/registry.ts) que el resto de
 * la app. En este repositorio, por diseño, la única implementación de
 * Mt5ClientLike es `createUnavailableMt5Client()` (MetaTrader 5 no tiene
 * API REST pública — solo funciona contra un terminal MT5 real en la
 * MISMA máquina, Windows/Wine — ver docs/mt5-demo-integration.md). Este
 * script reportará honestamente "no disponible" hasta que se despliegue
 * un Mt5ClientLike real; nada aquí simula ni fabrica una conexión.
 *
 * Nunca abre/cierra posiciones, nunca envía órdenes — solo lectura.
 *
 * Uso:
 *   npx tsx scripts/mt5-ingest-historical.mjs --symbol EURUSD --timeframe H1 --start 2024-01-01 --end 2024-06-01
 */
const { getMt5ExecutionAdapter } = await import("../src/lib/execution/registry.ts");
const { getMt5CredentialsFromEnv, Mt5ConfigError } = await import("../src/lib/execution/mt5CredentialConfig.ts");
const { ingestMt5HistoricalData, Mt5NotDemoError, Mt5SymbolUnavailableError } = await import("../src/lib/marketData/mt5HistoricalIngestion.ts");

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

function usageAndExit(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Uso: npx tsx scripts/mt5-ingest-historical.mjs --symbol EURUSD --timeframe H1 --start 2024-01-01 --end 2024-06-01");
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.symbol || !args.timeframe || !args.start || !args.end) {
    usageAndExit("faltan argumentos requeridos (--symbol, --timeframe, --start, --end)");
  }
  if (!["H1", "H4", "D1"].includes(args.timeframe)) {
    usageAndExit(`timeframe no soportado: "${args.timeframe}" (soportados: H1, H4, D1)`);
  }

  let credentials;
  try {
    credentials = getMt5CredentialsFromEnv();
  } catch (err) {
    if (err instanceof Mt5ConfigError) {
      // Nunca imprime CUÁL variable falta — solo que la configuración está incompleta.
      console.error(`[MT5] ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const adapter = getMt5ExecutionAdapter();

  console.log("[MT5] Connecting to demo server");
  const connectResult = await adapter.connect(credentials);
  if (!connectResult.connected) {
    console.error(`[MT5] Connection failed: ${connectResult.error}`);
    process.exitCode = 1;
    return;
  }

  try {
    const verifiedDemo = await adapter.verifyAccountIsDemo();
    if (!verifiedDemo) {
      console.error("[MT5] Account is not a MetaTrader 5 DEMO account — aborting, no data will be ingested.");
      process.exitCode = 1;
      return;
    }
    console.log("[MT5] Demo account verified");

    const result = await ingestMt5HistoricalData(adapter, {
      edgeLabSymbol: args.symbol,
      timeframe: args.timeframe,
      startDate: new Date(args.start),
      endDate: new Date(args.end),
    });

    console.log(`[MT5] Symbol discovered: ${result.mt5Symbol}`);
    console.log(`[MT5] Downloaded ${result.importStats.rowsRead} ${args.timeframe} bars`);
    console.log(
      `[MT5] Import status: ${result.importStats.status} (inserted=${result.importStats.inserted} updated=${result.importStats.updated} duplicates=${result.importStats.duplicates} invalid=${result.importStats.invalid} skipped=${result.importStats.skipped})`
    );
    if (result.importStats.error) console.error(`[MT5] Import error: ${result.importStats.error}`);
    if (result.dataset) {
      console.log(`[MT5] ResearchDataset id: ${result.dataset.id}`);
      console.log(`[MT5] Dataset hash: ${result.dataset.datasetHash}`);
      console.log(`[MT5] rowCount=${result.dataset.rowCount} coveragePct=${result.dataset.coveragePct} gapCount=${result.dataset.gapCount} quality=${result.dataset.quality}`);
    } else {
      console.log("[MT5] No dataset registered — no valid rows were persisted for this range.");
    }

    if (result.importStats.status === "FAILED") process.exitCode = 1;
  } catch (err) {
    if (err instanceof Mt5NotDemoError || err instanceof Mt5SymbolUnavailableError) {
      console.error(`[MT5] ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    await adapter.disconnect();
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    const dbModule = await import("../src/lib/db.ts");
    const prisma = dbModule.prisma ?? dbModule.default?.prisma;
    await prisma.$disconnect();
  });
