const path = require("path");

// electron-builder's win.signAndEditExecutable is disabled (set to false) because
// enabling it makes electron-builder try to download the full winCodeSign toolchain,
// which fails in this environment (needs symlink privileges we don't have). That flag
// also happens to gate icon embedding via rcedit, so we run rcedit ourselves here
// instead, after packaging but before the installer/portable exe are built.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const { rcedit } = await import("rcedit");
  const exeName = `${context.packager.appInfo.productFilename || "Ledgerly"}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, "..", "build-resources", "icon.ico");

  await rcedit(exePath, { icon: iconPath });
  console.log(`[afterPack] Set icon on ${exePath}`);
};
