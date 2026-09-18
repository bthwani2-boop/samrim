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

  return undefined;
}

module.exports = {
  resolveGoogleServicesFile,
};
