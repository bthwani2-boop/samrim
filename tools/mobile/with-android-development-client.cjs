"use strict";

const fs = require("fs");
const path = require("path");

const canonicalEnvExample = path.resolve(
  __dirname,
  "../../infra/local/.env.example",
);

function readCanonicalPort(envKey) {
  if (!fs.existsSync(canonicalEnvExample)) return undefined;

  const source = fs.readFileSync(canonicalEnvExample, "utf8");
  const match = source.match(new RegExp(`^${envKey}=(\\d+)$`, "m"));
  if (!match) {
    throw new Error(`Missing canonical Metro port in ${canonicalEnvExample}: ${envKey}`);
  }

  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid canonical Metro port ${envKey}=${match[1]}`);
  }

  return port;
}

function metroEnvKey(appKey) {
  return `SAMRIM_${appKey.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_METRO_PORT`;
}

function resolveAndroidMetroPort(appKey) {
  return readCanonicalPort(metroEnvKey(appKey));
}

function pluginName(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

function withCanonicalAndroidDevelopmentClient(config, appKey) {
  if (!config || typeof config !== "object") {
    throw new Error(`Invalid Expo config for ${appKey}`);
  }

  const port = resolveAndroidMetroPort(appKey);
  const defaultLaunchURL = `http://127.0.0.1:${port}`;
  const existingPlugins = Array.isArray(config.plugins) ? config.plugins : [];
  const pluginsWithoutDevClient = existingPlugins.filter(
    (plugin) => pluginName(plugin) !== "expo-dev-client",
  );

  return {
    ...config,
    developmentClient: {
      ...(config.developmentClient ?? {}),
      silentLaunch: true,
    },
    plugins: [
      [
        "expo-dev-client",
        {
          launchMode: "most-recent",
          android: {
            launchMode: "most-recent",
            defaultLaunchURL,
          },
        },
      ],
      ...pluginsWithoutDevClient,
    ],
  };
}

module.exports = {
  withCanonicalAndroidDevelopmentClient,
};
