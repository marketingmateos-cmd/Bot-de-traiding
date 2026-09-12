// Runs before the server starts on every launch, against whichever SQLite
// file is actually being used (the freshly-copied template on a first
// install, or an existing user's database carried over from a previous
// version). The packaged app has no bundled `prisma` CLI — Next's file
// tracer only includes what's actually imported by the server, and the CLI
// binary isn't imported by any code path — so schema updates can't use
// `prisma db push` here. Instead this applies the same additive changes by
// hand, idempotently, using the already-bundled @prisma/client's raw-SQL
// escape hatch. Without this, an existing install's database keeps its old
// schema forever and every query touching a new column/table throws.
// Loaded via an absolute path (not a bare "@prisma/client" specifier)
// because this script lives inside the Electron app's own asar bundle,
// which is a sibling of — not an ancestor of — the "app" resource dir
// (resources/app/node_modules) that actually has the generated client with
// the matching platform query-engine binary. Node resolves an absolute
// require() by the file's real disk location, so @prisma/client's own
// internal relative requires still work correctly from there.
const path = require("node:path");
const { PrismaClient } = require(path.join(process.env.APP_DIR, "node_modules", "@prisma", "client"));

async function columnExists(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return rows.some((r) => r.name === column);
}

async function tableExists(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table);
  return rows.length > 0;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    if (!(await columnExists(prisma, "Asset", "assetClass"))) {
      console.log("[migrate] adding Asset.assetClass");
      await prisma.$executeRawUnsafe(`ALTER TABLE "Asset" ADD COLUMN "assetClass" TEXT NOT NULL DEFAULT 'CRYPTO'`);
    }

    if (!(await columnExists(prisma, "PaperAccount", "riskLevel"))) {
      console.log("[migrate] adding PaperAccount.riskLevel");
      await prisma.$executeRawUnsafe(`ALTER TABLE "PaperAccount" ADD COLUMN "riskLevel" INTEGER NOT NULL DEFAULT 5`);
    }

    if (!(await columnExists(prisma, "PaperPosition", "riskLevelAtEntry"))) {
      console.log("[migrate] adding PaperPosition.riskLevelAtEntry");
      await prisma.$executeRawUnsafe(`ALTER TABLE "PaperPosition" ADD COLUMN "riskLevelAtEntry" INTEGER`);
    }

    if (!(await columnExists(prisma, "Trade", "riskLevelAtEntry"))) {
      console.log("[migrate] adding Trade.riskLevelAtEntry");
      await prisma.$executeRawUnsafe(`ALTER TABLE "Trade" ADD COLUMN "riskLevelAtEntry" INTEGER`);
    }

    if (!(await tableExists(prisma, "BotConfig"))) {
      console.log("[migrate] creating BotConfig");
      await prisma.$executeRawUnsafe(`CREATE TABLE "BotConfig" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "accountId" TEXT NOT NULL DEFAULT 'main-paper-account',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "status" TEXT NOT NULL DEFAULT 'WAITING',
        "statusDetail" TEXT,
        "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
        "lastRunAt" DATETIME,
        "lastRunDurationMs" INTEGER,
        "nextRunAt" DATETIME,
        "updatedAt" DATETIME NOT NULL
      )`);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BotConfig" ("id", "accountId", "isActive", "status", "intervalSeconds", "updatedAt") VALUES ('main', 'main-paper-account', true, 'WAITING', 60, CURRENT_TIMESTAMP)`
      );
    }

    console.log("[migrate] schema up to date");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
