import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/lib/test/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration tests share one real SQLite file (test.db) across test
    // files — running files in parallel worker processes against that one
    // file causes spurious FK-violation/lock errors under concurrent
    // writes. Sequential file execution trades some speed for reliability.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
