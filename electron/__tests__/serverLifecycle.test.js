import { describe, expect, it } from "vitest";
import { isServerRunning } from "../serverLifecycle.js";

// Fase 2 — see serverLifecycle.js for the full bug writeup. This is the
// guard that stops electron/main.js's `activate` handler (macOS dock
// re-click after every window is closed) from spawning a second server
// child process — and re-running the DB migration — on top of one still
// alive from app launch.
describe("isServerRunning (Fase 2 — Electron activate double-server fix)", () => {
  it("is false when no server process has ever been started", () => {
    expect(isServerRunning(null)).toBe(false);
    expect(isServerRunning(undefined)).toBe(false);
  });

  it("is true for a live child process (not exited, not killed)", () => {
    expect(isServerRunning({ exitCode: null, killed: false })).toBe(true);
  });

  it("is false once the process has exited, even if never explicitly killed", () => {
    expect(isServerRunning({ exitCode: 0, killed: false })).toBe(false);
    expect(isServerRunning({ exitCode: 1, killed: false })).toBe(false);
  });

  it("is false once .kill() was called, even if exitCode hasn't updated yet", () => {
    expect(isServerRunning({ exitCode: null, killed: true })).toBe(false);
  });
});
