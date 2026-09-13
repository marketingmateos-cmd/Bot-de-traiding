// Fase 2 fix — public/sw.js's CACHE_NAME was a hardcoded literal that never
// changed across deployments/builds. The service worker's own `activate`
// handler cleans up any cache whose name differs from the current
// CACHE_NAME — but since that name never changed, the cleanup was a no-op
// every single deploy, and any stable-URL asset served through the
// cache-first `fetch` handler (manifest.json, icons, the precached
// `/dashboard` shell, anything not hashed per-build) could get stuck
// serving a stale, pre-deploy version indefinitely once cached, with no
// expiration and no way for a returning user to see the update short of
// manually clearing site data.
//
// Run this before `next build` in every build path (npm run build,
// vercel-build, the desktop prepare script) so every new build ships a
// service worker whose CACHE_NAME is guaranteed to differ from the
// previous one, making the existing `activate` cleanup logic actually work.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_NAME_LINE = /const CACHE_NAME = "[^"]*";/;

export function stampServiceWorker(swPath, version) {
  const original = readFileSync(swPath, "utf8");
  if (!CACHE_NAME_LINE.test(original)) {
    throw new Error(`stampServiceWorker: could not find a CACHE_NAME declaration in ${swPath}`);
  }
  const stamped = original.replace(CACHE_NAME_LINE, `const CACHE_NAME = "crypto-ai-trading-lab-${version}";`);
  writeFileSync(swPath, stamped);
  return stamped;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const swPath = join(root, "public", "sw.js");
  const version = String(Date.now());
  stampServiceWorker(swPath, version);
  console.log(`-> public/sw.js CACHE_NAME stamped to crypto-ai-trading-lab-${version}`);
}
