#!/usr/bin/env node
// Evaluate real Expo config for the presentation hosts. No prebuild, EAS or device mutation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const apps = ["customer", "merchant", "captain"];

export function resolvedConfigIssues(name, manifest, config) {
  const problems = [];
  const check = (condition, label) => { if (!condition) problems.push(name + ": " + label); };
  check(config.slug === manifest.slug, "slug drift");
  check(config.scheme === manifest.scheme, "deep-link scheme drift");
  check(config.owner === manifest.owner, "EAS owner drift");
  check(config.android?.package === manifest.androidPackage, "Android identity drift");
  check(config.ios?.bundleIdentifier === manifest.iosBundleIdentifier, "iOS identity drift");
  check(config.extra?.eas?.projectId === manifest.projectId, "EAS project drift");
  const localization = (config.plugins ?? []).filter(
    p => p === "expo-localization" || (Array.isArray(p) && p[0] === "expo-localization")
  );
  check(localization.length === 1, "exactly one canonical expo-localization plugin is required");
  if (localization.length === 1) {
    const settings = localization[0][1];
    check(settings?.forcesRTL === true, "native RTL must be forced centrally");
    check(JSON.stringify(settings?.supportedLocales?.ios) === '["ar"]', "iOS Arabic locale missing");
    check(JSON.stringify(settings?.supportedLocales?.android) === '["ar"]', "Android Arabic locale missing");
    check(settings?.allowDynamicLocaleChangesAndroid === false, "unexpected Android runtime locale switching");
  }
  if (name !== "captain") {
    check(config.web?.bundler === "metro" && config.web?.output === "server",
      "Expo Web must retain the approved server renderer");
  } else {
    check(!config.web || config.web.output !== "server",
      "Captain must not start an unapproved Expo Web host");
  }
  return problems;
}

export function easBuildIssues(name, config) {
  const problems = [];
  const check = (ok, label) => { if (!ok) problems.push(name + ": " + label); };
  const cli = config.cli ?? {};
  const build = config.build ?? {};
  const expectedNames = ["base", "development", "internal", "ios-simulator"];
  check(Object.keys(build).length === expectedNames.length &&
    expectedNames.every(profileName => Object.hasOwn(build, profileName)),
    "unapproved EAS build profile or missing stage-4 profile");
  check(cli.version === "24.7.0" && cli.appVersionSource === "remote" &&
    cli.requireCommit === true && cli.promptToConfigurePushNotifications === false,
    "EAS CLI pin or safe build settings drift");
  const base = build.base ?? {};
  const nodePin = readFileSync(join(root, ".node-version"), "utf8").trim();
  const pnpmPin = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager.split("@")[1];
  check(base.node === nodePin && base.pnpm === pnpmPin, "EAS remote toolchain mismatch");
  check(base.env?.COREPACK_ENABLE_DOWNLOAD_PROMPT === "0", "Corepack cloud prompt must be disabled");
  for (const profileName of ["development", "internal"]) {
    const profile = build[profileName] ?? {};
    check(profile.extends === "base", profileName + " must inherit the pinned base");
    check(profile.credentialsSource === "remote",
      profileName + " must use Expo-managed credentials, not missing local credentials.json");
    check(profile.distribution === "internal" && profile.android?.buildType === "apk",
      profileName + " must build an internal installable APK, not store distribution");
    check(profile.environment === (profileName === "internal" ? "preview" : "development"),
      profileName + " uses wrong EAS environment");
    check(profile.channel === (profileName === "internal" ? "preview" : "development"),
      profileName + " uses wrong EAS Update channel");
    check(profile.developmentClient === (profileName === "development" ? true : undefined),
      profileName + " development-client mode drift");
  }
  const simulator = build["ios-simulator"] ?? {};
  check(simulator.extends === "development" && simulator.ios?.simulator === true,
    "iOS simulator must inherit development and never require a physical-device profile");
  check(!Object.values(build).some(p => p && (p.autoSubmit || p.distribution === "store")),
    "stage-4 source must not auto-submit or enable store release");
  return problems;
}

function evaluatedConfig(name) {
  const cwd = join(root, "apps", name);
  // Both executable and arguments are fixed literals; never interpolate user input.
  const cmd = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "pnpm exec expo config --json"]
    : ["exec", "expo", "config", "--json"];
  const result = spawnSync(cmd, args, {
    cwd, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
  });
  assert.equal(result.status, 0, name + ": expo config failed to resolve (exit " + result.status + ")");
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(name + ": expo config did not return JSON");
  }
}

export function verifyResolvedConfigs() {
  let checked = 0;
  for (const app of apps) {
    const manifest = JSON.parse(readFileSync(join(root, "apps", app, "mobile.config.json"), "utf8"));
    const problems = resolvedConfigIssues(app, manifest, evaluatedConfig(app));
    assert.deepEqual(problems, [], "Resolved Expo configuration is not safe: " + problems.join("; "));
    if (app === "customer" || app === "merchant") {
      const eas = JSON.parse(readFileSync(join(root, "apps", app, "eas.json"), "utf8"));
      const issues = easBuildIssues(app, eas);
      assert.deepEqual(issues, [], "Remote EAS profile configuration is not safe: " + issues.join("; "));
    }
    checked++;
  }
  return checked;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("STAGE4_EXPO_RESOLVED_CONFIG_PASS apps=" + verifyResolvedConfigs() + " native_build=NOT_RUN");
}
