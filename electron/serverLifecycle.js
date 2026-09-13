// Fase 2 fix, extracted as a plain, dependency-free module so it is
// directly unit-testable without mocking Electron/child_process: on macOS,
// closing every window doesn't quit the app, and clicking the dock icon
// fires `activate`. electron/main.js used to call createWindow()
// unconditionally there, which called startServer() unconditionally too —
// spawning a brand-new server child process (and re-running the DB
// migration) even though the original one from app launch was still alive
// and listening on the app's fixed port. That orphaned the first process
// (its reference was simply overwritten, so before-quit could never kill
// it) and raced a second server against the same port.
//
// `isServerRunning` is the guard: main.js only calls startServer() when
// this returns false.
function isServerRunning(serverProcess) {
  return Boolean(serverProcess) && serverProcess.exitCode === null && !serverProcess.killed;
}

// Fase 4 — "Bot 24/7": closing every window used to always quit the whole
// app on Windows/Linux, which (via the app's own before-quit handler) also
// killed the server child process — so an ACTIVE bot, mid-scan, stopped the
// instant the user closed the window. This is the decision the
// window-all-closed handler makes: quit for real only when the user
// explicitly asked to (the tray's "Salir" item, or the OS quitting the app)
// or when there's no active bot to lose by quitting; otherwise stay running
// in the background (main.js creates a tray icon in that case) so the
// server — and its self-scheduling loop — keeps going exactly as it does
// with the window open.
function shouldQuitOnAllWindowsClosed({ isQuitting, botActive, platform }) {
  if (isQuitting) return platform !== "darwin";
  if (!botActive) return platform !== "darwin";
  return false; // active bot, user didn't ask to quit — stay in the tray instead
}

module.exports = { isServerRunning, shouldQuitOnAllWindowsClosed };
