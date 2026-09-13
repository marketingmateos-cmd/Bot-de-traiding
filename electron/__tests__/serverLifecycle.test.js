import { describe, expect, it } from "vitest";
import { isServerRunning, shouldQuitOnAllWindowsClosed } from "../serverLifecycle.js";

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

// Fase 4 — "Bot 24/7": before this fix, closing every window always quit
// the whole app (and therefore the server) on Windows/Linux, stopping an
// ACTIVE bot mid-scan. This is the decision window-all-closed now makes.
describe("shouldQuitOnAllWindowsClosed (Fase 4 — Bot 24/7 background-run fix)", () => {
  it("never quits on Windows/Linux while the bot is active and the user didn't ask to quit — the actual bug fix", () => {
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: false, botActive: true, platform: "win32" })).toBe(false);
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: false, botActive: true, platform: "linux" })).toBe(false);
  });

  it("quits on Windows/Linux when the bot is inactive — preserves the pre-existing close-to-quit convenience", () => {
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: false, botActive: false, platform: "win32" })).toBe(true);
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: false, botActive: false, platform: "linux" })).toBe(true);
  });

  it("quits whenever the user explicitly asked to (tray's Salir / OS quit), even with an active bot", () => {
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: true, botActive: true, platform: "win32" })).toBe(true);
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: true, botActive: false, platform: "linux" })).toBe(true);
  });

  it("never auto-quits on macOS, active bot or not — matches the existing platform convention (Dock/activate)", () => {
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: false, botActive: true, platform: "darwin" })).toBe(false);
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: false, botActive: false, platform: "darwin" })).toBe(false);
  });

  it("on macOS, explicit quit intent is handled by app.quit() itself (Cmd+Q / tray Salir), not by this window-all-closed guard", () => {
    // isQuitting=true here would normally already be mid-quit via a direct
    // app.quit() call elsewhere; window-all-closed firing on top of that on
    // macOS still shouldn't trigger a SECOND app.quit() from this guard.
    expect(shouldQuitOnAllWindowsClosed({ isQuitting: true, botActive: true, platform: "darwin" })).toBe(false);
  });
});
