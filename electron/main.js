// Electron main process — this is the entire "desktop wrapper": it starts
// the bundled Next.js server (the exact same app, built with
// `output: "standalone"`) against a private SQLite database file that lives
// in this user's app-data folder, waits for it to come up, then opens a
// normal window pointed at it. No external server, no Postgres, no
// Codespaces/terminal for the user to manage.
const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const { spawn } = require("node:child_process");

const isPackaged = app.isPackaged;
const resourcesDir = isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const appDir = path.join(resourcesDir, "app"); // .next/standalone contents
const serverScript = path.join(appDir, "server.js");
const migrateScript = path.join(__dirname, "migrate.js");
const templateDb = path.join(resourcesDir, "template.db");

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

async function createWindow() {
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
