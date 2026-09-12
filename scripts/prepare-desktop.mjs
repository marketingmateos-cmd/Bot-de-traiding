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
// Run before `electron-builder`.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// BUILD_TARGET=desktop switches next.config.ts to `output: "standalone"` —
// only the packaged desktop build needs that, not a normal hosted deploy —
// set here (via execSync's env, not shell syntax) so it works the same way
// whether this runs under bash (Linux/macOS) or PowerShell (Windows CI).
console.log("-> Compilando Next.js en modo standalone (para el escritorio)...");
execSync("npx next build", { cwd: root, env: { ...process.env, BUILD_TARGET: "desktop" }, stdio: "inherit" });

execSync("node scripts/copy-standalone-assets.mjs", { cwd: root, stdio: "inherit" });

console.log("-> Generando la base de datos plantilla (esquema + datos de ejemplo)...");
const resourcesDir = join(root, "build-resources");
mkdirSync(resourcesDir, { recursive: true });
const templateDbPath = join(resourcesDir, "template.db");
rmSync(templateDbPath, { force: true });

const env = { ...process.env, DATABASE_URL: `file:${templateDbPath}` };
execSync("npx prisma db push --skip-generate --accept-data-loss", { cwd: root, env, stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "inherit" });

console.log("-> Listo. Base de datos plantilla en", templateDbPath);
