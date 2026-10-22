"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_ROOT_PATTERN = /^app-(client|partner|captain|field)$/;

function normalizeProjectRoot(projectRoot) {
  const absolute = path.resolve(projectRoot);
  const app = path.basename(absolute);
  if (!APP_ROOT_PATTERN.test(app)) {
    throw new Error(`Unsupported Samrim mobile Metro project root: ${absolute}`);
  }
  return { absolute, app };
}

function getSamrimMetroCacheRoot(projectRoot) {
  const { app } = normalizeProjectRoot(projectRoot);
  return path.join(os.tmpdir(), "samrim-metro-cache", app);
}

function createSamrimMetroConfig(projectRoot) {
  const { absolute } = normalizeProjectRoot(projectRoot);
  const expoMetroConfigPath = require.resolve("expo/metro-config", {
    paths: [absolute],
  });
  const { getDefaultConfig } = require(expoMetroConfigPath);
  const fileStorePath = require.resolve(
    "@expo/metro-config/build/binary-file-store.js",
    { paths: [path.dirname(expoMetroConfigPath)] },
  );
  const { FileStore } = require(fileStorePath);
  const config = getDefaultConfig(absolute);
  const appPackage = JSON.parse(fs.readFileSync(path.join(absolute, "package.json"), "utf8"));
  const workspaceDependencies = Object.entries({
    ...appPackage.dependencies,
    ...appPackage.devDependencies,
  })
    .filter(([, version]) => version.startsWith("workspace:"))
    .map(([name]) => fs.realpathSync(path.join(absolute, "node_modules", name)));
  const requiredRoots = new Set([
    absolute,
    path.join(path.resolve(absolute, "../.."), "node_modules"),
    ...workspaceDependencies,
  ]);
  // Expo discovers every workspace package; watch only this app and its actual dependencies.
  config.watchFolders = config.watchFolders.filter((root) => requiredRoots.has(root));
  config.resolver.unstable_enablePackageExports = true;
  config.cacheStores = [new FileStore({ root: getSamrimMetroCacheRoot(absolute) })];
  return config;
}

module.exports = { createSamrimMetroConfig, getSamrimMetroCacheRoot };
