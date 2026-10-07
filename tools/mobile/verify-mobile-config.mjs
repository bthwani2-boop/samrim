import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

import { createSamrimMetroConfig, getSamrimMetroCacheRoot } from "./create-samrim-metro-config.cjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const appsRoot = path.join(repoRoot, "apps");
const envExamplePath = path.join(repoRoot, "infra/local/.env.example");
const rootPackagePath = path.join(repoRoot, "package.json");
const localRuntimePath = path.join(repoRoot, "tools/dev/dev.ps1");
const metroOwnerPath = path.join(repoRoot, "tools/mobile/create-samrim-metro-config.cjs");
const launcherPath = path.join(repoRoot, "tools/dev/start-surface.mjs");
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--app")) {
  console.error("Usage: node tools/mobile/verify-mobile-config.mjs [--app app-name]");
  process.exit(1);
}
const requestedApp = args[1];
const requiredStringFields = [
  "name",
  "slug",
  "scheme",
  "owner",
  "version",
  "androidPackage",
  "iosBundleIdentifier",
  "projectId",
];

function parseEnv(text) {
  const map = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Malformed .env.example line: ${rawLine}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (map.has(key)) throw new Error(`Duplicate .env.example key: ${key}`);
    map.set(key, value);
  }
  return map;
}

function requirePort(env, key) {
  const raw = env.get(key);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid canonical mobile/runtime TCP port ${key}=${raw ?? "<missing>"}`);
  }
  return value;
}

const apps = fs
  .readdirSync(appsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((app) => fs.existsSync(path.join(appsRoot, app, "mobile.config.json")))
  .sort();

if (apps.length === 0) {
  console.error("No mobile hosts discovered from apps/*/mobile.config.json");
  process.exit(1);
}
if (requestedApp && !apps.includes(requestedApp)) {
  console.error(`Unknown mobile app: ${requestedApp}`);
  process.exit(1);
}
if (!fs.existsSync(localRuntimePath)) {
  console.error("Canonical local runtime owner is missing: tools/dev/dev.ps1");
  process.exit(1);
}
if (!fs.existsSync(metroOwnerPath)) {
  console.error("Canonical Metro cache owner is missing: tools/mobile/create-samrim-metro-config.cjs");
  process.exit(1);
}
for (const retired of [
  path.join(repoRoot, "tools/mobile/with-android-development-client.cjs"),
  path.join(repoRoot, "tools/mobile/with-android-development-client.d.cts"),
]) {
  if (fs.existsSync(retired)) {
    console.error(`Retired native Metro launch wrapper remains: ${path.relative(repoRoot, retired)}`);
    process.exit(1);
  }
}

const env = parseEnv(fs.readFileSync(envExamplePath, "utf8"));
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, "utf8"));
const seen = {
  slug: new Map(),
  scheme: new Map(),
  androidPackage: new Map(),
  iosBundleIdentifier: new Map(),
  projectId: new Map(),
};
const seenPorts = new Map();
const seenMetroCacheRoots = new Map();
const servicePorts = new Set([
  requirePort(env, "SAMRIM_IDENTITY_PORT"),
  requirePort(env, "SAMRIM_DSH_PORT"),
]);
let failed = false;
const workspaceConfig = fs.readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
for (const setting of ["frozenLockfile", "saveExact"]) {
  if (!new RegExp(`^${setting}: true$`, "m").test(workspaceConfig)) {
    console.error(`pnpm-workspace.yaml must enable ${setting}`);
    failed = true;
  }
}
const launcherSource = fs.readFileSync(launcherPath, "utf8");
for (const setting of ["EXPO_NO_METRO_WORKSPACE_ROOT", "EXPO_OFFLINE"]) {
  if (launcherSource.includes(setting)) {
    console.error(`The surface launcher must preserve Expo defaults instead of forcing ${setting}`);
    failed = true;
  }
}

const workspacePackages = new Map();
for (const owner of ["apps", "services", "packages"]) {
  for (const entry of fs.readdirSync(path.join(repoRoot, owner), { withFileTypes: true })) {
    const packagePath = path.join(repoRoot, owner, entry.name, "package.json");
    if (entry.isDirectory() && fs.existsSync(packagePath)) {
      const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      workspacePackages.set(pkg.name, packagePath);
    }
  }
}
const checkedPackages = new Set();
function checkDependencyPins(packagePath) {
  if (checkedPackages.has(packagePath)) return;
  checkedPackages.add(packagePath);
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, specifier] of Object.entries(pkg[section] ?? {})) {
      if (specifier.startsWith("workspace:")) {
        const dependencyPath = workspacePackages.get(name);
        if (!dependencyPath) throw new Error(`Missing workspace package ${name}`);
        checkDependencyPins(dependencyPath);
        continue;
      }
      const version = specifier.startsWith("npm:") ? specifier.slice(specifier.lastIndexOf("@") + 1) : specifier;
      if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) {
        console.error(`${path.relative(repoRoot, packagePath)}: ${section}.${name} must use an exact version; found ${specifier}`);
        failed = true;
      }
    }
  }
}
checkDependencyPins(rootPackagePath);

function checkNativeDependencies(appRoot, pkg) {
  const appRequire = createRequire(path.join(appRoot, "package.json"));
  const expoRequire = createRequire(appRequire.resolve("expo/package.json"));
  const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
  if (cliRequire("@expo/config/paths").getMetroServerRoot(appRoot) !== repoRoot) {
    throw new Error("Expo workspace resolution is disabled; remove EXPO_NO_METRO_WORKSPACE_ROOT");
  }
  const autolinkingPath = expoRequire.resolve("expo-modules-autolinking/package.json");
  const autolinking = JSON.parse(fs.readFileSync(autolinkingPath, "utf8"));
  const bin = path.resolve(path.dirname(autolinkingPath), autolinking.bin["expo-modules-autolinking"]);
  const result = spawnSync(process.execPath, [bin, "verify", "--project-root", appRoot, "--platform", "android", "--json"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Expo Autolinking failed: ${result.stderr.trim()}`);
  const native = JSON.parse(result.stdout);
  const conflicts = native.duplicates.filter((entry) => entry.duplicates.some((duplicate) => duplicate.version !== entry.version));
  if (conflicts.length) {
    throw new Error(`Conflicting native versions: ${conflicts.map((entry) => `${entry.name} (${[entry.version, ...entry.duplicates.map((duplicate) => duplicate.version)].join(", ")})`).join("; ")}`);
  }
  for (const [name, dependency] of Object.entries(native.dependencies)) {
    const expected = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    if (expected && dependency.version !== expected) {
      throw new Error(`Installed ${name}=${dependency.version} does not match app-owned ${expected}; run pnpm install`);
    }
  }
  console.log(`MOBILE_NATIVE_DEPENDENCIES=PASS app=${path.basename(appRoot)} conflicts=0`);
}

for (const app of apps) {
  const appRoot = path.join(appsRoot, app);
  const configPath = path.join(appRoot, "mobile.config.json");
  const appConfigPath = path.join(appRoot, "app.config.ts");
  const projectPath = path.join(appRoot, "project.json");
  const packagePath = path.join(appRoot, "package.json");
  const metroConfigPath = path.join(appRoot, "metro.config.cjs");

  if (!fs.existsSync(appConfigPath) || !fs.existsSync(projectPath) || !fs.existsSync(packagePath) || !fs.existsSync(metroConfigPath)) {
    console.error(`${app}: missing app.config.ts, project.json, package.json or metro.config.cjs`);
    failed = true;
    continue;
  }

  const metroSource = fs.readFileSync(metroConfigPath, "utf8");
  if (!metroSource.includes('require("../../tools/mobile/create-samrim-metro-config.cjs")') || !metroSource.includes("createSamrimMetroConfig(__dirname)")) {
    console.error(`${app}: Metro must use the canonical app-scoped cache owner`);
    failed = true;
  }
  for (const forbidden of [
    "watchFolders",
    "resolver.nodeModulesPaths",
    "resolver.extraNodeModules",
    "resolver.disableHierarchicalLookup",
    "EXPO_NO_METRO_WORKSPACE_ROOT",
  ]) {
    if (metroSource.includes(forbidden)) {
      console.error(`${app}: manual Metro monorepo override must be absent: ${forbidden}`);
      failed = true;
    }
  }

  try {
    const metroRuntimeConfig = createSamrimMetroConfig(appRoot);
    if (!Array.isArray(metroRuntimeConfig.cacheStores) || metroRuntimeConfig.cacheStores.length !== 1) {
      console.error(`${app}: canonical Metro config must expose exactly one cache store`);
      failed = true;
    }
    const cacheRoot = getSamrimMetroCacheRoot(appRoot);
    const previous = seenMetroCacheRoots.get(cacheRoot);
    if (previous) {
      console.error(`Metro cache collision: ${cacheRoot} used by ${previous} and ${app}`);
      failed = true;
    } else {
      seenMetroCacheRoots.set(cacheRoot, app);
    }
    if (path.basename(cacheRoot) !== app) {
      console.error(`${app}: Metro cache root is not app-scoped: ${cacheRoot}`);
      failed = true;
    }
  } catch (error) {
    console.error(`${app}: canonical Metro config failed: ${error.message}`);
    failed = true;
  }

  const appConfigSource = fs.readFileSync(appConfigPath, "utf8");
  if (appConfigSource.includes("with-android-development-client") || appConfigSource.includes("defaultLaunchURL") || appConfigSource.includes("developmentClient")) {
    console.error(`${app}: native development-client launch target must not be app-config owned; Expo CLI owns the daily launch URL`);
    failed = true;
  }

  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  if (!Array.isArray(project.tags) || !project.tags.includes("type:app")) {
    console.error(`${app}: project.json missing type:app`);
    failed = true;
  }
  if (project.root !== `apps/${app}`) {
    console.error(`${app}: project.root does not match apps/${app}`);
    failed = true;
  }
  if (project.targets?.serve !== undefined || project.targets?.dev !== undefined) {
    console.error(`${app}: Nx must not expose a secondary local runtime target`);
    failed = true;
  }

  const rootCommandName = app.replace(/^app-/, "");
  const expectedRootScript = `pnpm --dir apps/${app} dev`;
  if (rootPackage.scripts?.[rootCommandName] !== expectedRootScript) {
    console.error(`${app}: root alias must enter the app directory and run its owned dev command`);
    failed = true;
  }

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  checkDependencyPins(packagePath);
  if (!pkg.dependencies?.["@expo/ui"]) {
    console.error(`${app}: the app must own its Expo UI native dependency`);
    failed = true;
  }
  if (pkg.scripts?.["eas-build-post-install"] !== `node ../../tools/mobile/verify-mobile-config.mjs --app ${app}`) {
    console.error(`${app}: EAS must run the shared dependency/configuration check after installation`);
    failed = true;
  }
  const eas = JSON.parse(fs.readFileSync(path.join(appRoot, "eas.json"), "utf8"));
  if (process.env.EAS_NO_FROZEN_LOCKFILE === "1" || Object.values(eas.build).some((profile) => profile.env?.EAS_NO_FROZEN_LOCKFILE === "1")) {
    console.error(`${app}: EAS immutable lockfile installation must remain enabled`);
    failed = true;
  }
  if (!requestedApp || requestedApp === app) {
    try {
      checkNativeDependencies(appRoot, pkg);
    } catch (error) {
      console.error(`${app}: ${error.message}`);
      failed = true;
    }
  }
  if (pkg.scripts?.dev !== "node ../../tools/dev/start-surface.mjs") {
    console.error(`${app}: package.json scripts.dev must use the shared direct surface launcher`);
    failed = true;
  }
  for (const forbidden of ["start", "serve"]) {
    if (pkg.scripts?.[forbidden] !== undefined) {
      console.error(`${app}: package.json must not expose scripts.${forbidden}; scripts.dev is canonical`);
      failed = true;
    }
  }

  const envToken = app.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
  const metroPortKey = `SAMRIM_${envToken}_METRO_PORT`;
  let metroPort;
  try {
    metroPort = requirePort(env, metroPortKey);
  } catch (error) {
    console.error(error.message);
    failed = true;
  }
  if (metroPort !== undefined) {
    const previous = seenPorts.get(metroPort);
    if (previous) {
      console.error(`Metro port collision: ${metroPort} used by ${previous} and ${app}`);
      failed = true;
    } else {
      seenPorts.set(metroPort, app);
    }
    if (servicePorts.has(metroPort)) {
      console.error(`${app}: Metro port ${metroPort} collides with Identity/DSH runtime`);
      failed = true;
    }
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  for (const field of requiredStringFields) {
    if (typeof config[field] !== "string" || config[field].trim().length === 0) {
      console.error(`${app}: invalid ${field}`);
      failed = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(config, "nativeCapabilities")) {
    console.error(`${app}: nativeCapabilities shadow registry must be absent`);
    failed = true;
  }

  for (const field of Object.keys(seen)) {
    const value = config[field];
    if (typeof value !== "string") continue;
    const previous = seen[field].get(value);
    if (previous) {
      console.error(`${field} collision: ${value} used by ${previous} and ${app}`);
      failed = true;
    } else {
      seen[field].set(value, app);
    }
  }
}

const toolingText = [
  fs.readFileSync(localRuntimePath, "utf8"),
  fs.readFileSync(metroOwnerPath, "utf8"),
].join("\n");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const entry of fs.readdirSync(appsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const configPath = path.join(appsRoot, entry.name, "mobile.config.json");
  if (!fs.existsSync(configPath)) continue;

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // These deployable identities are globally distinctive. A literal occurrence
  // in runtime tooling therefore proves an improper mirrored identity.
  for (const field of ["androidPackage", "iosBundleIdentifier", "slug", "projectId"]) {
    if (typeof config[field] === "string" && toolingText.includes(config[field])) {
      console.error(`deployable identity mirror detected in tooling: ${field}=${config[field]}`);
      failed = true;
    }
  }

  // Schemes such as "client" and "captain" are intentionally short semantic
  // names and legitimately occur in runtime tooling as surface/service names.
  // Bare substring presence is therefore not evidence of an identity mirror.
  // Reject only an actual hard-coded scheme URL or explicit scheme assignment.
  if (typeof config.scheme === "string") {
    const escapedScheme = escapeRegExp(config.scheme);

    const hardCodedSchemeUrl = new RegExp(
      `(?:^|[^a-z0-9+.-])${escapedScheme}:\\/\\/`,
      "im",
    );

    const hardCodedSchemeAssignment = new RegExp(
      `["']?scheme["']?\\s*[:=]\\s*["']${escapedScheme}["']`,
      "im",
    );

    if (
      hardCodedSchemeUrl.test(toolingText) ||
      hardCodedSchemeAssignment.test(toolingText)
    ) {
      console.error(`deployable identity mirror detected in tooling: scheme=${config.scheme}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("MOBILE_LOCAL_RUNTIME_OWNER=apps/*/package.json");
console.log("MOBILE_RUNTIME_ENTRYPOINT=PACKAGE_DEV");
console.log("MOBILE_ROOT_COMMANDS=DIRECTORY_ALIASES");
console.log("MOBILE_SHARED_LAUNCHER=tools/dev/start-surface.mjs");
console.log("MOBILE_SHADOW_NX_RUNTIME_TARGETS=0");
console.log("MOBILE_METRO_PORT_AUTHORITY=CANONICAL_ENV");
console.log("MOBILE_METRO_CACHE_OWNER=APP_SCOPED");
console.log("MOBILE_MONOREPO_FAST_REFRESH=EXPO_AUTOCONFIG");
console.log("MOBILE_CONFIG=PASS apps=" + apps.join(","));
