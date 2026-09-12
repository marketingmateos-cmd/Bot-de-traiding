// Vercel serverless functions have no persistent filesystem, so the SQLite
// file used everywhere else (desktop app, Render) doesn't work there — this
// generates a Postgres variant of the schema for that one deployment target.
// Every field in schema.prisma is already a plain String/Int/Float/DateTime/
// Boolean (enums and Json were removed for SQLite compatibility earlier), so
// swapping just the datasource provider is enough; no field types change.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "prisma", "schema.prisma");
const target = join(root, "prisma", "schema.postgres.prisma");

const schema = readFileSync(source, "utf8");
const converted = schema.replace('provider = "sqlite"', 'provider = "postgresql"');

if (converted === schema) {
  console.error("No se encontró `provider = \"sqlite\"` en prisma/schema.prisma — revisa el archivo.");
  process.exit(1);
}

writeFileSync(target, converted);
console.log("-> Generado prisma/schema.postgres.prisma para el despliegue en Vercel.");
