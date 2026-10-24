"use strict";

const path = require("node:path");

// Metro's fallback watcher opens one fs.watch handle per directory on Windows.
// In a pnpm monorepo the shared node_modules tree alone can exceed 20k handles
// per Metro instance, causing the watcher to time out and Android bundles to 500.
// Node 24 supports native recursive fs.watch on Windows with one handle per root.
// Opt into that backend for our local Windows development environment without
// editing installed dependencies or affecting macOS/Linux builds.
function enableWindowsNativeMetroWatcher(expoMetroConfigPath) {
  if (process.platform !== "win32") return;

  // Expo and Metro can each load their own file-map implementation.
  for (const packageName of ["metro-file-map", "@expo/metro-file-map"]) {
    const packageEntry = require.resolve(packageName, {
      paths: [path.dirname(expoMetroConfigPath)],
    });
    const watcherModule = require(
      path.join(path.dirname(packageEntry), "watchers", "NativeWatcher.js"),
    );
    const NativeWatcher = watcherModule.default;
    if (typeof NativeWatcher?.isSupported !== "function") {
      throw new Error(`METRO_NATIVE_WATCHER_UNAVAILABLE package=${packageName}`);
    }
    NativeWatcher.isSupported = () => true;
  }
}

module.exports = { enableWindowsNativeMetroWatcher };
