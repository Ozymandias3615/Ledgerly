const { app, BrowserWindow, Tray, Menu, shell, ipcMain, dialog, nativeImage } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { signInWithGoogle } = require("./googleAuth");
let googleConfig = {};
try {
  googleConfig = require("./config");
} catch {
  // electron/config.js is gitignored (holds OAuth secrets) and may be absent,
  // e.g. in CI-built packages. Google sign-in is disabled rather than crashing.
}

const isDev = !app.isPackaged;
const STATIC_SERVER_PORT = 5050;
const GITHUB_REPO = "Ozymandias3615/Ledgerly";

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
let tray = null;
let isQuitting = false;

// Compares dotted version strings numerically (e.g. "0.1.10" > "0.1.9").
// Returns 1 if a > b, -1 if a < b, 0 if equal.
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) return numA > numB ? 1 : -1;
  }
  return 0;
}

async function checkForUpdates(silent) {
  let release;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);
    release = await res.json();
  } catch (err) {
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Update Check Failed",
        message: "Couldn't check for updates.",
        detail: err.message,
      });
    }
    return;
  }

  const latestVersion = String(release.tag_name || "").replace(/^v/, "");
  const currentVersion = app.getVersion();
  if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "You're up to date",
        message: `Ledgerly ${currentVersion} is the latest version.`,
      });
    }
    return;
  }

  const assetExt = process.platform === "darwin" ? ".dmg" : ".exe";
  const asset = (release.assets || []).find((a) => a.name.endsWith(assetExt));
  const downloadUrl = asset ? asset.browser_download_url : release.html_url;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Update Available",
    message: `Ledgerly ${latestVersion} is available (you have ${currentVersion}).`,
    detail: "Download the new version and reinstall to update.",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    shell.openExternal(downloadUrl);
  }
}

function createTray() {
  const iconPath = path.join(
    __dirname,
    "..",
    isDev ? "public" : "build",
    process.platform === "win32" ? "favicon.ico" : "iconTemplate.png"
  );
  const trayImage = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") {
    trayImage.setTemplateImage(true);
  }
  tray = new Tray(trayImage);
  tray.setToolTip("Ledgerly");
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Open Ledgerly",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Check for Updates…",
      click: () => checkForUpdates(false),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("click", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

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
  // Closing the window hides it instead of quitting, so Ledgerly keeps running
  // in the background (tray icon) until "Quit" is chosen from the tray menu.
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

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

// Ledgerly keeps running in the tray after the window is closed, so a second
// launch (e.g. double-clicking the shortcut again) must not try to spin up
// its own window/static server — that would collide with the running
// instance's fixed port. Everything below that touches app lifecycle or IPC
// is registered only in the branch that actually holds the lock, so a losing
// second instance can never reach app.whenReady() / the port bind at all.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

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
  //
  // The path is also recorded in savedFilePaths so open-file below will only
  // ever open a file this app just wrote via a user-confirmed save dialog -
  // never an arbitrary path the renderer asks for. Main-process IPC handlers
  // must not trust the renderer: a single XSS/dependency-compromise bug there
  // would otherwise be enough to launch any local executable via open-file.
  const savedFilePaths = new Set();
  ipcMain.handle("save-file", async (event, filename, data) => {
    const downloadsDir = app.getPath("downloads");
    const ext = path.extname(filename).replace(/^\./, "");
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(downloadsDir, filename),
      filters: ext ? [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }] : undefined,
    });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, Buffer.from(data));
    savedFilePaths.add(result.filePath);
    return result.filePath;
  });

  ipcMain.handle("open-file", async (event, filePath) => {
    if (!savedFilePaths.has(filePath)) {
      throw new Error("Can only open a file this app just saved.");
    }
    return shell.openPath(filePath);
  });

  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("check-for-updates", () => checkForUpdates(false));

  app.whenReady().then(() => {
    createWindow();
    createTray();
    // Silent background check so users see an update dialog without asking for one;
    // failures (offline, rate limits) are swallowed rather than shown.
    checkForUpdates(true);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  });

  app.on("before-quit", () => { isQuitting = true; });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
