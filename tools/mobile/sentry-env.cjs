"use strict";

const fs = require("fs");
const path = require("path");

function appEnvSuffix(appKey) {
  return appKey.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function optionalString(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function configuredFilePath(value) {
  const normalized = optionalString(value);
  if (!normalized) return undefined;
  if (/^[A-Za-z]:[\\/]/.test(normalized) || /^\\\\[^\\]+\\[^\\]+/.test(normalized)) {
    return normalized;
  }
  return path.resolve(normalized);
}

function firstEnvironmentValue(environment, names) {
  for (const name of names) {
    const value = optionalString(environment[name]);
    if (value) return value;
  }
  return undefined;
}

function scopedNames(baseName, appKey, aliases = []) {
  const suffix = appEnvSuffix(appKey);
  return [
    `${baseName}_${suffix}`,
    ...aliases.map((alias) => `${alias}_${suffix}`),
    baseName,
    ...aliases,
  ];
}

function resolveAppLocalGoogleServicesFile(appKey) {
  const repoRoot = path.resolve(__dirname, "../..");
  const absolute = path.join(repoRoot, "apps", appKey, "google-services.json");
  return fs.existsSync(absolute) ? absolute : undefined;
}

function resolveGoogleServicesFile(appKey, environment = process.env) {
  const suffix = appEnvSuffix(appKey);
  const appLocal = resolveAppLocalGoogleServicesFile(appKey);
  if (appLocal) return appLocal;

  const scoped = configuredFilePath(environment[`GOOGLE_SERVICES_JSON_${suffix}`]);
  if (scoped) return scoped;

  const common = configuredFilePath(environment.GOOGLE_SERVICES_JSON);
  if (common) return common;

  const repoRoot = path.resolve(__dirname, "../..");
  const secretsConfigPath = path.join(repoRoot, "secrets.local.mobile.json");
  if (fs.existsSync(secretsConfigPath)) {
    try {
      const secretsData = JSON.parse(fs.readFileSync(secretsConfigPath, "utf8"));
      const customPath = configuredFilePath(secretsData[appKey]);
      if (customPath && fs.existsSync(customPath)) return customPath;
    } catch {
      // Invalid local-only secret mapping is ignored here and surfaced by
      // explicit preflight when a native Firebase input is required.
    }
  }

  const defaultPath = path.join("C:", "bthwani-secrets", "firebase", appKey, "google-services.json");
  return fs.existsSync(defaultPath) ? defaultPath : undefined;
}

function resolveSentryEnvironment(appKey, environment = process.env) {
  return {
    organization: firstEnvironmentValue(environment, scopedNames("SENTRY_ORG", appKey, ["BTHWANI_SENTRY_ORG"])),
    project: firstEnvironmentValue(environment, scopedNames("SENTRY_PROJECT", appKey, ["BTHWANI_SENTRY_PROJECT"])),
    authToken: firstEnvironmentValue(environment, scopedNames("SENTRY_AUTH_TOKEN", appKey, ["BTHWANI_SENTRY_AUTH_TOKEN"])),
    url: firstEnvironmentValue(environment, scopedNames("SENTRY_URL", appKey, ["BTHWANI_SENTRY_URL"])),
    dsn: firstEnvironmentValue(environment, scopedNames("EXPO_PUBLIC_SENTRY_DSN", appKey, ["BTHWANI_SENTRY_DSN"])),
    appEnvironment:
      firstEnvironmentValue(environment, scopedNames("EXPO_PUBLIC_APP_ENV", appKey, ["BTHWANI_APP_ENV"])) ??
      "development",
    tracesSampleRate:
      firstEnvironmentValue(
        environment,
        scopedNames("EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", appKey, ["BTHWANI_SENTRY_TRACES_SAMPLE_RATE"]),
      ) ?? "0",
    debug:
      firstEnvironmentValue(environment, scopedNames("EXPO_PUBLIC_SENTRY_DEBUG", appKey, ["BTHWANI_SENTRY_DEBUG"])) ??
      "false",
    startupProbe:
      firstEnvironmentValue(
        environment,
        scopedNames("EXPO_PUBLIC_SENTRY_STARTUP_PROBE", appKey, ["BTHWANI_SENTRY_STARTUP_PROBE"]),
      ) ?? "false",
  };
}

module.exports = {
  appEnvSuffix,
  resolveGoogleServicesFile,
  resolveSentryEnvironment,
};
