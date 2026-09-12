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
const { spawn } = require("node:child_process");

const isPackaged = app.isPackaged;
const resourcesDir = isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const appDir = path.join(resourcesDir, "app"); // .next/standalone contents
const serverScript = path.join(appDir, "server.js");
const templateDb = path.join(resourcesDir, "template.db");

const userDataDir = app.getPath("userData");
const dbPath = path.join(userDataDir, "crypto-ai-trading-lab.db");
const PORT = 47821; // fixed local port; only ever bound to 127.0.0.1

let serverProcess = null;
let mainWindow = null;

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

function startServer() {
  ensureDatabase();

  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: appDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
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
  startServer();

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
