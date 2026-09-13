import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stampServiceWorker } from "../stamp-service-worker.mjs";

// Fase 2 — public/sw.js's CACHE_NAME was a hardcoded literal that never
// changed across builds, so the service worker's own cache-cleanup logic
// (delete any cache whose name != CACHE_NAME) was a permanent no-op. This
// script stamps a fresh, build-unique CACHE_NAME into sw.js so every new
// build's activate handler actually evicts the previous deploy's cache.

let dir;
let swPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sw-stamp-test-"));
  swPath = join(dir, "sw.js");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("stampServiceWorker", () => {
  it("replaces the CACHE_NAME literal with one containing the given version", () => {
    writeFileSync(
      swPath,
      `const CACHE_NAME = "crypto-ai-trading-lab-v1";\nconst PRECACHE_URLS = ["/dashboard"];\n`
    );

    stampServiceWorker(swPath, "12345");

    const content = readFileSync(swPath, "utf8");
    expect(content).toContain('const CACHE_NAME = "crypto-ai-trading-lab-12345";');
    // Nothing else in the file should be touched.
    expect(content).toContain('const PRECACHE_URLS = ["/dashboard"];');
  });

  it("produces a different CACHE_NAME each time it's stamped with a different version — the actual bug fix", () => {
    writeFileSync(swPath, `const CACHE_NAME = "crypto-ai-trading-lab-v1";\n`);

    stampServiceWorker(swPath, "111");
    const firstStamp = readFileSync(swPath, "utf8");

    stampServiceWorker(swPath, "222");
    const secondStamp = readFileSync(swPath, "utf8");

    // This is exactly what makes the service worker's own
    // `keys.filter((k) => k !== CACHE_NAME)` cleanup logic actually work
    // across deploys instead of being a permanent no-op.
    expect(firstStamp).not.toBe(secondStamp);
  });

  it("throws a clear error if the file has no CACHE_NAME declaration to stamp", () => {
    writeFileSync(swPath, `console.log("no cache name here");\n`);
    expect(() => stampServiceWorker(swPath, "123")).toThrow(/CACHE_NAME/);
  });
});
