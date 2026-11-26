#!/usr/bin/env node
// Source admission only. Resolve the actual installed Expo CLI without
// prebuild, signing, EAS upload, device mutation or credential logging.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertRegisteredIdentity } from "./verify-app-identity.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const surfaces = ["customer", "merchant", "captain"];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = value => object(value) ? Object.keys(value).sort() : [];
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const hasKeys = (value, expected) => object(value) && same(keys(value), [...expected].sort());
const readJson = path => JSON.parse(readFileSync(join(root,path), "utf8"));

export function resolvedConfigIssues(name, manifest, config) {
  const issues = [];
  const require = (ok, label) => { if (!ok) issues.push(name + ": " + label); };
  if (!surfaces.includes(name) || !object(manifest) || !object(config)) {
    return [name + ": unknown surface or invalid resolved configuration"];
  }
  try { assertRegisteredIdentity(name, manifest); }
  catch { issues.push(name + ": registered manifest identity drift"); }

  for (const [actual, expected, label] of [
    [config.slug,manifest.slug,"slug drift"],
    [config.scheme,manifest.scheme,"deep-link scheme drift"],
    [config.owner,manifest.owner,"EAS owner drift"],
    [config.name,manifest.name,"app name drift"],
    [config.version,manifest.version,"app version drift"],
    [config.android?.package,manifest.androidPackage,"Android identity drift"],
    [config.ios?.bundleIdentifier,manifest.iosBundleIdentifier,"iOS identity drift"],
    [config.extra?.eas?.projectId,manifest.projectId,"EAS project drift"],
    [config.extra?.appKey,manifest.slug,"app config owner drift"],
    [config.extra?.sourceRepo,"samrim","source repository drift"],
    [config.updates?.url,"https://u.expo.dev/" + manifest.projectId,"EAS update project drift"],
  ]) require(typeof expected === "string" && expected.length > 0 && actual === expected,label);
  require(same(config.runtimeVersion,{policy:"appVersion"}),"EAS update runtime policy drift");

  const platforms = name === "captain" ? ["android","ios"] : ["android","ios","web"];
  require(Array.isArray(config.platforms) && same([...config.platforms].sort(),platforms),
    "unapproved presentation platform");
  if (name === "captain") {
    require(!config.web || config.web.output !== "server","Captain must not start an unapproved Expo Web host");
  } else {
    require(config.web?.bundler === "metro" && config.web?.output === "server",
      "Expo Web must retain the approved server renderer");
  }

  if (!Array.isArray(config.plugins)) return [...issues,name + ": invalid plugins list"];
  const localization = config.plugins.filter(p => p === "expo-localization" ||
    (Array.isArray(p) && p[0] === "expo-localization"));
  require(localization.length === 1,"exactly one canonical expo-localization plugin is required");
  if (localization.length === 1) {
    const settings = Array.isArray(localization[0]) ? localization[0][1] : undefined;
    require(settings?.forcesRTL === true,"native RTL must be forced centrally");
    require(same(settings?.supportedLocales?.ios,["ar"]),"iOS Arabic locale missing");
    require(same(settings?.supportedLocales?.android,["ar"]),"Android Arabic locale missing");
    require(settings?.allowDynamicLocaleChangesAndroid === false,"unexpected Android runtime locale switching");
  }
  return issues;
}

export function easBuildIssues(name, config) {
  const issues = [];
  const require = (ok,label) => { if (!ok) issues.push(name + ": " + label); };
  if (!surfaces.includes(name) || !object(config)) return [name + ": invalid EAS configuration"];
  // This is the currently admitted development-only shape, not permission
  // to create another profile, submit, change credentials or spend money.
  require(hasKeys(config,["cli","build"]),"unapproved EAS top-level configuration");
  const cli = config.cli;
  require(hasKeys(cli,["version","appVersionSource","requireCommit","promptToConfigurePushNotifications"]) &&
    cli.version === "24.7.0" && cli.appVersionSource === "remote" &&
    cli.requireCommit === true && cli.promptToConfigurePushNotifications === false,
    "EAS CLI pin or safe build settings drift");
  const build = config.build;
  if (!hasKeys(build,["base","development","ios-simulator"])) {
    return [...issues,name + ": unapproved EAS build profile or missing development profile"];
  }
  const node = readFileSync(join(root,".node-version"),"utf8").trim();
  const pnpm = readJson("package.json").packageManager.match(/^pnpm@(\d+\.\d+\.\d+)$/)?.[1];
  const base = build.base;
  require(hasKeys(base,["node","pnpm","env"]) && base.node === node && pnpm && base.pnpm === pnpm,
    "EAS remote toolchain mismatch or unapproved base override");
  require(hasKeys(base?.env,["COREPACK_ENABLE_DOWNLOAD_PROMPT"]) &&
    base.env.COREPACK_ENABLE_DOWNLOAD_PROMPT === "0","unapproved EAS base environment override");

  const dev = build.development;
  require(hasKeys(dev,["extends","credentialsSource","environment","channel","developmentClient","distribution","android"]),
    "unapproved development profile override");
  require(dev?.extends === "base","development must inherit the pinned base");
  require(dev?.credentialsSource === "remote","development credential ownership differs from approved app configuration");
  require(dev?.environment === "development" && dev?.channel === "development",
    "development must use the development EAS environment and update channel");
  require(dev?.developmentClient === true,"development must enable the Expo development client");
  require(dev?.distribution === "internal" && hasKeys(dev.android,["buildType"]) && dev.android.buildType === "apk",
    "development must produce an internally installable APK, not store distribution");

  const simulator = build["ios-simulator"];
  require(hasKeys(simulator,["extends","ios"]) && simulator.extends === "development" &&
    hasKeys(simulator.ios,["simulator","image"]) && simulator.ios.simulator === true &&
    simulator.ios.image === "latest",
    "iOS simulator must inherit development without profile or native-platform overrides");
  return issues;
}

function evaluatedConfig(name) {
  const cwd = join(root,"apps",name);
  const cmd = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args = process.platform === "win32" ? ["/d","/s","/c","pnpm exec expo config --json"] :
    ["exec","expo","config","--json"];
  const result = spawnSync(cmd,args,{
    cwd,encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,
    env:{...process.env,EXPO_NO_TELEMETRY:"1"},
  });
  // stdout/stderr may contain local native config values: never attach either
  // to a diagnostic, including a malformed JSON error.
  assert.equal(result.status,0,name + ": installed Expo config resolution failed (exit " + result.status + ")");
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(name + ": Expo did not return a valid JSON configuration"); }
}

export function verifyResolvedConfigs() {
  for (const name of surfaces) {
    const manifest = readJson("apps/" + name + "/mobile.config.json");
    const issues = [
      ...resolvedConfigIssues(name,manifest,evaluatedConfig(name)),
      ...easBuildIssues(name,readJson("apps/" + name + "/eas.json")),
    ];
    assert.equal(issues.length,0,"Expo source admission failed: " + issues.join("; "));
  }
  return surfaces.length;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length,2,"Usage: node tools/mobile/verify-expo-config.mjs");
  console.log("EXPO_RESOLVED_CONFIG_PASS apps=" + verifyResolvedConfigs() +
    " eas_profiles=SOURCE_ONLY native_build=NOT_RUN signing=NOT_RUN");
}
