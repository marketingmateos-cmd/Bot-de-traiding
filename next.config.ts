import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" traces the minimal set of node_modules the server actually
  // needs and emits a self-contained server.js — this is what lets the
  // Electron desktop build ship without bundling the whole node_modules tree.
  output: "standalone",
};

export default nextConfig;
