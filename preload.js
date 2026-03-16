const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  showItemInFolder: (filePath) =>
    ipcRenderer.invoke("show-item-in-folder", filePath),
});
