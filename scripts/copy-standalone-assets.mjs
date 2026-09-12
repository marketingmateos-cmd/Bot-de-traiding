// Next's `output: "standalone"` deliberately omits static assets (so a normal
// deployment can serve them from a CDN instead) — anything running the
// standalone server.js directly (the Electron desktop app, this Railway
// deploy) has no CDN, so it must copy them in itself. Shared by
// prepare-desktop.mjs and the Railway build.
import { cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const standaloneDir = join(root, ".next", "standalone");

if (!existsSync(standaloneDir)) {
  console.error("No se encontró .next/standalone — ejecuta `npm run build` primero.");
  process.exit(1);
}

cpSync(join(root, ".next", "static"), join(standaloneDir, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(standaloneDir, "public"), { recursive: true });
console.log("-> Assets estáticos copiados al build standalone.");
