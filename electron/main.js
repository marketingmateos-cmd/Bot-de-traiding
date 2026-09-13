// Electron main process — this is the entire "desktop wrapper": it starts
// the bundled Next.js server (the exact same app, built with
// `output: "standalone"`) against a private SQLite database file that lives
// in this user's app-data folder, waits for it to come up, then opens a
// normal window pointed at it. No external server, no Postgres, no
// Codespaces/terminal for the user to manage.
const { app, BrowserWindow, shell, dialog, Tray, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { isServerRunning, shouldQuitOnAllWindowsClosed } = require("./serverLifecycle");

const isPackaged = app.isPackaged;
const resourcesDir = isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const appDir = path.join(resourcesDir, "app"); // .next/standalone contents
const serverScript = path.join(appDir, "server.js");
const migrateScript = path.join(__dirname, "migrate.js");
const templateDb = path.join(resourcesDir, "template.db");
// Packaged builds get this via extraResources (see package.json); in dev
// mode it's read straight from build-resources/ since nothing gets copied.
const trayIconPath = isPackaged ? path.join(resourcesDir, "icon.ico") : path.join(__dirname, "..", "build-resources", "icon.ico");

const userDataDir = app.getPath("userData");
const dbPath = path.join(userDataDir, "crypto-ai-trading-lab.db");
const PORT = 47821;
// The server listens on every network interface (not just loopback) so
// other devices on the same WiFi/LAN — e.g. a phone — can open
// http://<this-PC's-LAN-IP>:47821/dashboard directly, no internet hosting
// needed. The Electron window itself still always talks to its own server
// via 127.0.0.1, which works regardless of this setting.
const LISTEN_HOST = "0.0.0.0";

let serverProcess = null;
let mainWindow = null;
let tray = null;
let isQuitting = false; // set only by the tray's "Salir" item / OS quit — see Fase 4 below

function getLanUrls() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        urls.push(`http://${addr.address}:${PORT}/dashboard`);
      }
    }
  }
  return urls;
}

function ensureDatabase() {
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.copyFileSync(templateDb, dbPath);
  }
}

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) reject(new Error("El servidor local no respondió a tiempo."));
          else setTimeout(attempt, 250);
        });
    };
    attempt();
  });
}

// Fase 4 — asks the running server (single source of truth: BotConfig in
// the DB, the same row the Dashboard/Settings read and write) whether the
// bot is currently active, so window-all-closed can decide whether it's
// safe to fully quit or whether an active bot needs to keep running in the
// background. Best-effort: any failure (server not up yet, bad JSON) is
// treated as "not active" so a broken check never traps the user unable to
// close the app.
function fetchBotIsActive() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/bot/status`, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(Boolean(JSON.parse(body)?.config?.isActive));
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function ensureTray() {
  if (tray) return;
  try {
    tray = new Tray(trayIconPath);
  } catch {
    return; // missing icon file (e.g. a dev checkout without build-resources) — tray is a convenience, never fatal
  }
  tray.setToolTip("Crypto AI Trading Lab — el bot sigue corriendo en segundo plano");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Abrir Crypto AI Trading Lab",
        click: () => {
          if (BrowserWindow.getAllWindows().length === 0) createWindow();
          else mainWindow?.show();
        },
      },
      { type: "separator" },
      {
        label: "Salir (detiene el bot)",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
}

function runMigration() {
  return new Promise((resolve, reject) => {
    const migrateProcess = spawn(process.execPath, [migrateScript], {
      cwd: appDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        APP_DIR: appDir,
        DATABASE_URL: `file:${dbPath}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const logPath = path.join(userDataDir, "server.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    migrateProcess.stdout.pipe(logStream);
    migrateProcess.stderr.pipe(logStream);

    migrateProcess.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`La migración de la base de datos falló (código ${code}). Revisa server.log.`));
    });
    migrateProcess.on("error", reject);
  });
}

async function startServer() {
  ensureDatabase();
  await runMigration();

  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: appDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: LISTEN_HOST,
      DATABASE_URL: `file:${dbPath}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const logPath = path.join(userDataDir, "server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  serverProcess.stdout.pipe(logStream);
  serverProcess.stderr.pipe(logStream);

  serverProcess.on("exit", (code) => {
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox(
        "Crypto AI Trading Lab",
        "El servidor interno se detuvo inesperadamente. Cierra y vuelve a abrir la aplicación."
      );
    }
  });
}

// Fase 2 fix: on macOS, closing every window doesn't quit the app, and
// clicking the dock icon fires `activate`, which used to call createWindow()
// unconditionally — spawning a brand-new server child process (and
// re-running the migration) even though the original one from app launch
// was still alive and listening on PORT. That orphaned the first process
// (its reference was simply overwritten, so before-quit could never kill
// it) and raced a second server against the same port. Only start the
// server once per app lifetime; a later `activate` with the server already
// up just opens a new window against it. See serverLifecycle.js for the
// guard itself (extracted there so it's unit-testable without mocking
// Electron/child_process).
async function createWindow() {
  if (!isServerRunning(serverProcess)) {
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox("Crypto AI Trading Lab", `No se pudo preparar la base de datos: ${err.message}`);
      app.quit();
      return;
    }

    try {
      await waitForServer(`http://127.0.0.1:${PORT}/dashboard`);
    } catch (err) {
      dialog.showErrorBox("Crypto AI Trading Lab", `No se pudo iniciar la aplicación: ${err.message}`);
      app.quit();
      return;
    }
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: "#05070a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/dashboard`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const lanUrls = getLanUrls();
  if (lanUrls.length > 0) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Abrir en el móvil",
      message: "Para abrir esta app en tu móvil (misma WiFi que este PC):",
      detail:
        lanUrls.join("\n") +
        "\n\nAbre esa dirección en Safari/Chrome del móvil y usa \"Añadir a pantalla de inicio\". " +
        "Si el móvil no conecta, puede que el Firewall de Windows te haya preguntado al abrir esta app — dale a \"Permitir acceso\".",
      buttons: ["Entendido"],
    });
  }

  // Open any external link (e.g. a future "docs" link) in the OS browser
  // instead of navigating the app window away from localhost.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

app.whenReady().then(createWindow);

// Fase 4 fix — "Bot 24/7": closing the window used to always quit the whole
// app on Windows/Linux (`app.quit()` here, which `before-quit` below then
// used to kill the server) — meaning an ACTIVE bot, mid-scan, stopped the
// instant the user closed the window. Now: if the bot is active, the
// window closing just hides the app into the system tray — the server
// (and its self-scheduling loop, per botLoop.ts) keeps running exactly as
// it does today when the app is fully open. Only an inactive bot, or the
// tray's own "Salir" item, actually quits and stops the server.
app.on("window-all-closed", async () => {
  const botActive = isQuitting ? false : await fetchBotIsActive();
  if (shouldQuitOnAllWindowsClosed({ isQuitting, botActive, platform: process.platform })) {
    app.quit();
    return;
  }
  // Only the active-bot case needs the tray (a way back in without the
  // dock/taskbar icon) — an inactive bot on macOS keeps the pre-existing
  // behavior of just staying in the dock, no tray, reopened via `activate`.
  if (botActive) ensureTray();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
