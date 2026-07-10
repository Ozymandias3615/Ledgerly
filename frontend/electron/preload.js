const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  googleSignIn: () => ipcRenderer.invoke("google-sign-in"),
});
