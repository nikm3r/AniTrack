const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");

const IS_DEV = !app.isPackaged;
const SERVER_PORT = 3000;
const DEV_VITE_URL = "http://localhost:5173";

// Auto-updater — only active in packaged builds
let autoUpdater = null;
if (!IS_DEV) {
  try {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Silence the default logger — we handle events ourselves
    autoUpdater.logger = null;
  } catch (e) {
    console.error("[updater] Failed to load electron-updater:", e.message);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    if (IS_DEV) { resolve(); return; }

    try {
      process.env.NODE_ENV = "production";
      process.env.SERVER_PORT = String(SERVER_PORT);
      process.env.USER_DATA_PATH = app.getPath("userData");

      require(path.join(__dirname, "dist-server", "index.js"));

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
    } catch (err) {
      console.error("[main] Failed to load server:", err);
      reject(err);
    }
  });
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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    // Check for updates a few seconds after launch so it doesn't block startup
    if (autoUpdater) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    }
  });

  if (IS_DEV) {
    mainWindow.loadURL(DEV_VITE_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  // Forward updater events to the renderer
  if (autoUpdater) {
    autoUpdater.on("checking-for-update", () => {
      mainWindow?.webContents.send("updater:checking");
    });
    autoUpdater.on("update-available", (info) => {
      mainWindow?.webContents.send("updater:available", { version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      mainWindow?.webContents.send("updater:not-available");
    });
    autoUpdater.on("download-progress", (progress) => {
      mainWindow?.webContents.send("updater:progress", { percent: Math.round(progress.percent) });
    });
    autoUpdater.on("update-downloaded", (info) => {
      mainWindow?.webContents.send("updater:downloaded", { version: info.version });
    });
    autoUpdater.on("error", (err) => {
      mainWindow?.webContents.send("updater:error", { message: err.message });
    });
  }
}

ipcMain.handle("get-config", () => ({
  serverPort: SERVER_PORT, isDev: IS_DEV,
  userDataPath: app.getPath("userData"), version: app.getVersion(),
}));
ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));
ipcMain.handle("show-item-in-folder", (_e, p) => shell.showItemInFolder(p));

// Updater IPC
ipcMain.handle("updater:check", async () => {
  if (!autoUpdater) return { error: "Updater not available in dev mode" };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle("updater:install", () => {
  autoUpdater?.quitAndInstall(false, true);
});

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
  if (process.platform !== "darwin") app.quit();
});
