"use strict";

const fs = require("fs");
const path = require("path");

const LOCAL_ANDROID_METRO_CONTRACT = Object.freeze({
  "app-client": Object.freeze({ envKey: "SAMRIM_APP_CLIENT_METRO_PORT", port: 18101 }),
  "app-partner": Object.freeze({ envKey: "SAMRIM_APP_PARTNER_METRO_PORT", port: 18102 }),
  "app-captain": Object.freeze({ envKey: "SAMRIM_APP_CAPTAIN_METRO_PORT", port: 18103 }),
  "app-field": Object.freeze({ envKey: "SAMRIM_APP_FIELD_METRO_PORT", port: 18104 }),
});

const canonicalEnvExample = path.resolve(
  __dirname,
  "../../infra/local/compose/.env.example",
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

function resolveAndroidMetroPort(appKey) {
  const contract = LOCAL_ANDROID_METRO_CONTRACT[appKey];
  if (!contract) {
    throw new Error(`Unknown Android development client app: ${appKey}`);
  }

  const canonicalPort = readCanonicalPort(contract.envKey);
  if (canonicalPort !== undefined && canonicalPort !== contract.port) {
    throw new Error(
      `Android development client port drift for ${appKey}: ` +
        `${contract.port} != ${contract.envKey}=${canonicalPort}`,
    );
  }

  return contract.port;
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
  LOCAL_ANDROID_METRO_CONTRACT,
  resolveAndroidMetroPort,
  withCanonicalAndroidDevelopmentClient,
};
