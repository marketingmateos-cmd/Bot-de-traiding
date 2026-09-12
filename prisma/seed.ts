import { PrismaClient } from "@prisma/client";
import { STRATEGY_REGISTRY } from "../src/lib/engines/strategy";
import { SUPPORTED_ASSETS } from "../src/lib/env";
import { toJson } from "../src/lib/json";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Crypto AI Trading Lab...");

  const user = await prisma.user.upsert({
    where: { email: "marketingmateos@gmail.com" },
    update: {},
    create: { email: "marketingmateos@gmail.com", name: "Lab Operator" },
  });

  for (const asset of SUPPORTED_ASSETS) {
    await prisma.asset.upsert({
      where: { symbol: asset.symbol },
      update: {},
      create: { symbol: asset.symbol, name: asset.name },
    });
  }
  console.log(`Seeded ${SUPPORTED_ASSETS.length} assets.`);

  for (const def of STRATEGY_REGISTRY) {
    const strategy = await prisma.strategy.upsert({
      where: { id: def.id },
      update: {},
      create: {
        id: def.id,
        ownerId: user.id,
        kind: def.kind,
        name: def.name,
        description: `${def.name} — default v${def.version} configuration.`,
      },
    });

    await prisma.strategyVersion.upsert({
      where: { strategyId_version: { strategyId: strategy.id, version: def.version } },
      update: {},
      create: {
        strategyId: strategy.id,
        version: def.version,
        parameters: toJson(def.defaultParams),
        timeframe: def.timeframe,
        allowedMarkets: toJson([]),
        recommendedRegimes: toJson(def.recommendedRegimes),
        entryRules: toJson({ description: "See strategy implementation for entry logic." }),
        exitRules: toJson({ description: "Stop-loss / take-profit / trailing-stop as configured." }),
        stopLossPct: def.defaultStopLossPct,
        takeProfitPct: def.defaultTakeProfitPct,
        trailingStopPct: def.defaultTrailingStopPct,
        filters: toJson({}),
        costModel: toJson(def.costModel),
        changeLog: "Initial version.",
      },
    });
  }
  console.log(`Seeded ${STRATEGY_REGISTRY.length} strategies.`);

  const account = await prisma.paperAccount.upsert({
    where: { id: "main-paper-account" },
    update: {},
    create: {
      id: "main-paper-account",
      userId: user.id,
      name: "Main Paper Account",
      baseCurrency: "EUR",
      startingBalance: 100,
      cashBalance: 100,
      riskProfile: "BALANCED",
    },
  });
  console.log(`Seeded paper account ${account.id} with €${account.startingBalance}.`);

  const breakerNames = ["max-daily-loss", "max-drawdown", "max-trades", "data-corruption", "api-down", "position-inconsistency"];
  for (const name of breakerNames) {
    await prisma.circuitBreaker.upsert({
      where: { name },
      update: {},
      create: { name, kind: name.toUpperCase().replace(/-/g, "_"), threshold: toJson({}), isTripped: false },
    });
  }
  console.log(`Seeded ${breakerNames.length} circuit breakers (all untripped).`);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
