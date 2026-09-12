// Assembles everything electron-builder needs to package the desktop app:
//   1. Copies the Next.js static assets + public/ into the standalone server
//      output (Next's `output: "standalone"` intentionally omits these so
//      normal deployments can serve them from a CDN — the desktop app has
//      no CDN, so it needs to serve them itself).
//   2. Builds a fresh, pre-seeded SQLite database file to ship as the
//      "first launch" template (the running app copies this into the
//      user's per-machine app-data folder the first time it starts, then
//      only ever touches that copy).
//
// Run after `next build` and before `electron-builder`.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const standaloneDir = join(root, ".next", "standalone");

if (!existsSync(standaloneDir)) {
  console.error("No se encontró .next/standalone — ejecuta `npm run build` primero.");
  process.exit(1);
}

console.log("-> Copiando assets estáticos al build standalone...");
cpSync(join(root, ".next", "static"), join(standaloneDir, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(standaloneDir, "public"), { recursive: true });

console.log("-> Generando la base de datos plantilla (esquema + datos de ejemplo)...");
const resourcesDir = join(root, "build-resources");
mkdirSync(resourcesDir, { recursive: true });
const templateDbPath = join(resourcesDir, "template.db");
rmSync(templateDbPath, { force: true });

const env = { ...process.env, DATABASE_URL: `file:${templateDbPath}` };
execSync("npx prisma db push --skip-generate --accept-data-loss", { cwd: root, env, stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "inherit" });

console.log("-> Listo. Base de datos plantilla en", templateDbPath);
