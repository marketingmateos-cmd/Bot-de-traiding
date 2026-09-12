// Runs once when the production server (e.g. on Railway) boots: makes sure
// the SQLite database at DATABASE_URL has the current schema, and seeds it
// with demo data only the very first time (when it's empty) — never on
// later restarts/deploys, so real paper-trading history is never touched.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

execSync("npx prisma db push --skip-generate --accept-data-loss", {
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
