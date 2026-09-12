// Makes sure the database at DATABASE_URL has the current schema, and seeds
// it with demo data only the very first time (when it's empty) — never on
// later restarts/redeploys, so real paper-trading history is never touched.
// Runs at server boot on Railway; on Vercel (no persistent boot step, just
// serverless functions) it's run as part of the build instead — pass the
// schema file to use as the first argument (prisma/schema.postgres.prisma
// there, since Vercel has no filesystem for the default SQLite schema).
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const schemaArg = process.argv[2] ? `--schema=${process.argv[2]}` : "";

execSync(`npx prisma db push --skip-generate --accept-data-loss ${schemaArg}`, {
  stdio: "inherit",
  env: process.env,
});

const prisma = new PrismaClient();
const assetCount = await prisma.asset.count();
await prisma.$disconnect();

if (assetCount === 0) {
  console.log("-> Base de datos vacía, sembrando datos iniciales...");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: process.env });
} else {
  console.log(`-> Base de datos ya tiene datos (${assetCount} activos), no se siembra de nuevo.`);
}
