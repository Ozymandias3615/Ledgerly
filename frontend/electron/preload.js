const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  googleSignIn: () => ipcRenderer.invoke("google-sign-in"),
  saveFile: (filename, data) => ipcRenderer.invoke("save-file", filename, data),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
});
