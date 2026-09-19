"use strict";

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
  config.cacheStores = [new FileStore({ root: getSamrimMetroCacheRoot(absolute) })];
  return config;
}

module.exports = { createSamrimMetroConfig, getSamrimMetroCacheRoot };
