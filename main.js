const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

const IS_DEV = !app.isPackaged;
const SERVER_PORT = 3000;
const DEV_VITE_URL = "http://localhost:5173";

let serverProcess = null;

function findNode() {
  const candidates = [
    "/usr/bin/node",
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
    path.join(process.env.APPDATA || "", "nvm", "current", "node.exe"),
    path.join(process.env.ProgramFiles || "", "nodejs", "node.exe"),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { }
  }
  // Last resort — try to find node in PATH on Windows
  if (process.platform === "win32") {
    try {
      const result = require("child_process").execSync("where node", { encoding: "utf8" }).trim().split("\n")[0].trim();
      if (result) return result;
    } catch { }
  }
  return "node";
}

function startServer() {
  return new Promise((resolve, reject) => {
    if (IS_DEV) { resolve(); return; }

    const serverPath = path.join(process.resourcesPath, "dist-server", "index.js");
    const nodeBin = findNode();
    console.log("[main] Starting server:", nodeBin, serverPath);

    // NODE_PATH=resourcesPath so that require('better-sqlite3')
    // resolves to resources/better-sqlite3 (copied there as extraResource)
    serverProcess = spawn(nodeBin, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        SERVER_PORT: String(SERVER_PORT),
        USER_DATA_PATH: app.getPath("userData"),
        NODE_PATH: process.resourcesPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout.on("data", d => console.log("[server]", d.toString().trim()));
    serverProcess.stderr.on("data", d => console.error("[server:err]", d.toString().trim()));
    serverProcess.on("error", err => { console.error("[main] Spawn error:", err); reject(err); });

    const deadline = Date.now() + 15_000;
    const poll = () => {
      http.get(`http://localhost:${SERVER_PORT}/api/health`, res => {
        if (res.statusCode === 200) { console.log("[main] Server ready"); resolve(); }
        else retry();
      }).on("error", retry);
    };
    const retry = () => {
      if (Date.now() > deadline) { reject(new Error("Server did not start within 15s")); return; }
      setTimeout(poll, 300);
    };
    setTimeout(poll, 500);
  });
}

function stopServer() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    icon: path.join(__dirname, "icon.png"),
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (IS_DEV) {
    mainWindow.loadURL(DEV_VITE_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

ipcMain.handle("get-config", () => ({
  serverPort: SERVER_PORT, isDev: IS_DEV,
  userDataPath: app.getPath("userData"), version: app.getVersion(),
}));
ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));
ipcMain.handle("show-item-in-folder", (_e, p) => shell.showItemInFolder(p));

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error("[main] Startup failed:", err);
    app.quit();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") { stopServer(); app.quit(); }
});
app.on("before-quit", () => stopServer());
