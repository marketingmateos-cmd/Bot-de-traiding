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

module.exports = { isServerRunning };
