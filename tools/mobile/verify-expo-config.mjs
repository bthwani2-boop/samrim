#!/usr/bin/env node
// Source admission only: no prebuild, signing, cloud build or credential output.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertRegisteredIdentity } from "./verify-app-identity.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const surfaces = ["customer", "merchant", "captain"];
const rtlOptions = {
  supportedLocales: { ios: ["ar"], android: ["ar"] },
  forcesRTL: true,
  allowDynamicLocaleChangesAndroid: false,
};
const cliPolicy = {
  version: "24.7.0", appVersionSource: "remote", requireCommit: true,
  promptToConfigurePushNotifications: false,
};
const development = {
  extends: "base", credentialsSource: "remote", environment: "development",
  channel: "development", developmentClient: true, distribution: "internal",
  android: { buildType: "apk" },
};
const simulator = { extends: "development", ios: { simulator: true, image: "latest" } };

function readJson(relative) {
  try { return JSON.parse(readFileSync(join(root, relative), "utf8")); }
  catch { throw new Error("Cannot read the admitted JSON configuration: " + relative); }
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
// Exact JSON shape; keys are a set, arrays retain their declared order.
// No coercion, serialization equality or locale-dependent sort.
function exactKeys(value, expected) {
  return record(value) && Object.keys(value).length === expected.length &&
    expected.every(key => Object.hasOwn(value, key));
}
function exactJson(value, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.length === expected.length &&
      expected.every((entry, index) => Object.hasOwn(value, index) && exactJson(value[index], entry));
  }
  if (record(expected)) {
    const keys = Object.keys(expected);
    return exactKeys(value, keys) && keys.every(key => exactJson(value[key], expected[key]));
  }
  return Object.is(value, expected);
}
function exactSet(value, expected) {
  return Array.isArray(value) && value.length === expected.length &&
    expected.every(entry => value.includes(entry));
}
function diagnostics(name) {
  const issues = [];
  return { issues, require(condition, message) { if (!condition) issues.push(name + ": " + message); } };
}
function verifyLocalization(config, report) {
  const { require } = report;
  if (!Array.isArray(config.plugins)) {
    require(false, "invalid plugins list");
    return;
  }
  const plugins = config.plugins.filter(plugin =>
    plugin === "expo-localization" || (Array.isArray(plugin) && plugin[0] === "expo-localization"));
  require(plugins.length === 1, "exactly one canonical expo-localization plugin is required");
  if (plugins.length !== 1) return;
  const [plugin] = plugins;
  const tuple = Array.isArray(plugin) && plugin.length === 2;
  require(tuple, "invalid localization plugin tuple");
  const options = tuple ? plugin[1] : null;
  require(exactKeys(options, Object.keys(rtlOptions)) &&
    exactKeys(options.supportedLocales, Object.keys(rtlOptions.supportedLocales)), "unapproved localization options");
  require(options?.forcesRTL === rtlOptions.forcesRTL, "native RTL must be forced centrally");
  require(exactJson(options?.supportedLocales?.ios, rtlOptions.supportedLocales.ios), "iOS Arabic locale missing");
  require(exactJson(options?.supportedLocales?.android, rtlOptions.supportedLocales.android), "Android Arabic locale missing");
  require(options?.allowDynamicLocaleChangesAndroid === rtlOptions.allowDynamicLocaleChangesAndroid,
    "unexpected Android runtime locale switching");
}

export function resolvedConfigIssues(name, manifest, config) {
  const report = diagnostics(name);
  const { require, issues } = report;
  if (!surfaces.includes(name) || !record(manifest) || !record(config)) {
    return [name + ": unknown surface or invalid resolved configuration"];
  }
  try { assertRegisteredIdentity(name, manifest); }
  catch { require(false, "registered manifest identity drift"); }
  const fields = [
    [config.slug, manifest.slug, "slug drift"],
    [config.scheme, manifest.scheme, "deep-link scheme drift"],
    [config.owner, manifest.owner, "EAS owner drift"],
    [config.name, manifest.name, "app name drift"],
    [config.version, manifest.version, "app version drift"],
    [config.android?.package, manifest.androidPackage, "Android identity drift"],
    [config.ios?.bundleIdentifier, manifest.iosBundleIdentifier, "iOS identity drift"],
    [config.extra?.eas?.projectId, manifest.projectId, "EAS project drift"],
    [config.extra?.appKey, manifest.slug, "app config owner drift"],
    [config.extra?.sourceRepo, "samrim", "source repository drift"],
    [config.updates?.url, "https://u.expo.dev/" + manifest.projectId, "EAS update project drift"],
  ];
  for (const [actual, expected, label] of fields) {
    require(typeof expected === "string" && expected.length > 0 && actual === expected, label);
  }
  require(exactJson(config.runtimeVersion, { policy: "appVersion" }), "EAS update runtime policy drift");
  const platforms = name === "captain" ? ["android", "ios"] : ["android", "ios", "web"];
  require(exactSet(config.platforms, platforms), "unapproved presentation platform");
  if (name === "captain") require(config.web?.output !== "server", "Captain must not start an unapproved Expo Web host");
  else require(config.web?.bundler === "metro" && config.web?.output === "server", "Expo Web must retain the approved server renderer");
  verifyLocalization(config, report);
  return issues;
}

function toolchain() {
  const node = readFileSync(join(root, ".node-version"), "utf8").trim();
  const manager = readJson("package.json").packageManager;
  const pnpm = typeof manager === "string" ? /^pnpm@(\d+\.\d+\.\d+)$/.exec(manager)?.[1] : undefined;
  assert.match(node, /^\d+\.\d+\.\d+$/, "Missing exact Node pin");
  assert.ok(pnpm, "Missing exact pnpm pin");
  return { node, pnpm };
}
export function easBuildIssues(name, config) {
  const { require, issues } = diagnostics(name);
  if (!surfaces.includes(name) || !record(config)) return [name + ": invalid EAS configuration"];
  require(exactKeys(config, ["cli", "build"]), "unapproved EAS top-level configuration");
  require(exactJson(config.cli, cliPolicy), "EAS CLI pin or safe build settings drift");
  const build = config.build;
  if (!exactKeys(build, ["base", "development", "ios-simulator"])) {
    return [...issues, name + ": unapproved EAS build profile or missing development profile"];
  }
  const base = build.base;
  const pins = toolchain();
  require(exactKeys(base, ["node", "pnpm", "env"]) &&
    base.node === pins.node && base.pnpm === pins.pnpm, "EAS remote toolchain mismatch or unapproved base override");
  require(exactJson(base?.env, { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" }), "unapproved EAS base environment override");
  const dev = build.development;
  require(exactKeys(dev, Object.keys(development)), "unapproved development profile override");
  require(dev?.extends === development.extends, "development must inherit the pinned base");
  require(dev?.credentialsSource === development.credentialsSource, "development credential ownership differs from approved app configuration");
  require(dev?.environment === development.environment && dev?.channel === development.channel,
    "development must use the development EAS environment and update channel");
  require(dev?.developmentClient === development.developmentClient, "development must enable the Expo development client");
  require(dev?.distribution === development.distribution && exactJson(dev?.android, development.android),
    "development must produce an internally installable APK, not store distribution");
  require(exactJson(build["ios-simulator"], simulator), "iOS simulator must inherit development without profile or native-platform overrides");
  return issues;
}

function evaluatedConfig(name) {
  const cwd = join(root, "apps", name);
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "cmd.exe" : "pnpm",
    windows ? ["/d", "/s", "/c", "pnpm exec expo config --json"] : ["exec", "expo", "config", "--json"], {
      cwd, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
    });
  assert.equal(result.status, 0, name + ": installed Expo config resolution failed (exit " + result.status + ")");
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(name + ": Expo did not return a valid JSON configuration"); }
}
export function verifyResolvedConfigs() {
  for (const name of surfaces) {
    const manifest = readJson("apps/" + name + "/mobile.config.json");
    const issues = [
      ...resolvedConfigIssues(name, manifest, evaluatedConfig(name)),
      ...easBuildIssues(name, readJson("apps/" + name + "/eas.json")),
    ];
    assert.equal(issues.length, 0, "Expo source admission failed: " + issues.join("; "));
  }
  return surfaces.length;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 2, "Usage: node tools/mobile/verify-expo-config.mjs");
  console.log("EXPO_RESOLVED_CONFIG_PASS apps=" + verifyResolvedConfigs() + " eas_profiles=SOURCE_ONLY native_build=NOT_RUN signing=NOT_RUN");
}
