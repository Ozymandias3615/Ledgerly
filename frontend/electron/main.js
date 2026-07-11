const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { signInWithGoogle } = require("./googleAuth");
const googleConfig = require("./config");

const isDev = !app.isPackaged;
const STATIC_SERVER_PORT = 5050;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// CRA uses BrowserRouter, which needs real http:// paths to resolve client-side
// routes. Serving the build over file:// breaks that (blank screen), so a local
// static server is used instead, with an SPA fallback to index.html.
function startStaticServer(buildDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = path.join(buildDir, urlPath);
      if (!filePath.startsWith(buildDir)) {
        filePath = buildDir;
      }
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          filePath = path.join(buildDir, "index.html");
        }
        const ext = path.extname(filePath);
        res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
        fs.createReadStream(filePath).pipe(res);
      });
    });
    // Fixed port (not 0/random) so it can be added to the backend's CORS allowlist.
    server.listen(STATIC_SERVER_PORT, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

let mainWindow = null;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", isDev ? "public" : "build", "app-icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow = win;
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });

  if (isDev) {
    win.loadURL("http://localhost:3000");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const buildDir = path.join(__dirname, "..", "build");
    const port = await startStaticServer(buildDir);
    win.loadURL(`http://127.0.0.1:${port}`);
  }

  // Open external links (e.g. OAuth) in the OS browser instead of inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("google-sign-in", async () => {
  if (!googleConfig.GOOGLE_CLIENT_ID || !googleConfig.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google sign-in is not configured (electron/config.js is missing client credentials).");
  }
  return signInWithGoogle({
    clientId: googleConfig.GOOGLE_CLIENT_ID,
    clientSecret: googleConfig.GOOGLE_CLIENT_SECRET,
  });
});

// Lets the user rename the export and pick where it's saved, via the native
// Save dialog (defaulting to the OS Downloads folder with the suggested
// name). Returns the chosen path, or null if the dialog was cancelled.
ipcMain.handle("save-file", async (event, filename, data) => {
  const downloadsDir = app.getPath("downloads");
  const ext = path.extname(filename).replace(/^\./, "");
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(downloadsDir, filename),
    filters: ext ? [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }] : undefined,
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, Buffer.from(data));
  return result.filePath;
});

ipcMain.handle("open-file", async (event, filePath) => {
  return shell.openPath(filePath);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
