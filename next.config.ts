import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" traces the minimal set of node_modules the server actually
  // needs and emits a self-contained server.js — this is what lets the
  // Electron desktop build ship without bundling the whole node_modules tree.
  // Only that packaged build needs it: a normal hosted deploy (Render, etc.)
  // uses the plain `next build` + `next start` flow instead, which is the
  // standard, most-tested path and doesn't need a hand-invoked server.js or
  // a manual static-asset copy.
  output: process.env.BUILD_TARGET === "desktop" ? "standalone" : undefined,
};

export default nextConfig;
