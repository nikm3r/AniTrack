const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");

const IS_DEV = !app.isPackaged;
const SERVER_PORT = 3000;
const DEV_VITE_URL = "http://localhost:5173";

function startServer() {
  return new Promise((resolve, reject) => {
    if (IS_DEV) { resolve(); return; }

    try {
      process.env.NODE_ENV = "production";
      process.env.SERVER_PORT = String(SERVER_PORT);
      process.env.USER_DATA_PATH = app.getPath("userData");

      // Run server in-process — same module resolver as Electron,
      // so better-sqlite3 in app.asar.unpacked is found automatically
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
  if (process.platform !== "darwin") app.quit();
});
