import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const appsRoot = path.join(repoRoot, "apps");
const envExamplePath = path.join(repoRoot, "infra/local/.env.example");
const rootPackagePath = path.join(repoRoot, "package.json");
const runtimePath = path.join(repoRoot, "tools/dev/runtime.ps1");
const appOpenerPath = path.join(repoRoot, "tools/dev/open-mobile-apps.ps1");
const devicePolicyPath = path.join(repoRoot, "tools/dev/device-policy.psm1");
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
if (!fs.existsSync(runtimePath) || !fs.existsSync(appOpenerPath) || !fs.existsSync(devicePolicyPath)) {
  console.error("Canonical runtime owner is missing: tools/dev/runtime.ps1");
  process.exit(1);
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
const servicePorts = new Set([
  requirePort(env, "SAMRIM_IDENTITY_PORT"),
  requirePort(env, "SAMRIM_DSH_PORT"),
]);
let failed = false;

for (const app of apps) {
  const appRoot = path.join(appsRoot, app);
  const configPath = path.join(appRoot, "mobile.config.json");
  const projectPath = path.join(appRoot, "project.json");
  const packagePath = path.join(appRoot, "package.json");

  if (!fs.existsSync(projectPath) || !fs.existsSync(packagePath)) {
    console.error(`${app}: missing project.json or package.json`);
    failed = true;
    continue;
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
  const expectedRootScript = `pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App ${app}`;
  if (rootPackage.scripts?.[rootCommandName] !== expectedRootScript) {
    console.error(`${app}: root command must route to the canonical app opener`);
    failed = true;
  }

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const forbidden of ["start", "dev", "serve"]) {
    if (pkg.scripts?.[forbidden] !== undefined) {
      console.error(`${app}: package.json must not expose scripts.${forbidden}; use the root runtime command`);
      failed = true;
    }
  }
  for (const [scriptName, command] of Object.entries(pkg.scripts ?? {})) {
    if (typeof command === "string" && /\b(?:expo|react-native)\s+start\b/i.test(command)) {
      console.error(`${app}: package script '${scriptName}' exposes a shadow Metro runtime path`);
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

const toolingText = [runtimePath, appOpenerPath, devicePolicyPath]
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

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
if (!toolingText.includes("device-policy.psm1")) {
  console.error("mobile tooling must consume the canonical device policy owner");
  failed = true;
}
if (failed) process.exit(1);
console.log("MOBILE_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("MOBILE_APP_OPENER=tools/dev/open-mobile-apps.ps1");
console.log("MOBILE_DEVICE_POLICY=tools/dev/device-policy.psm1");
console.log("MOBILE_RUNTIME_ENTRYPOINTS=1_PER_APP");
console.log("MOBILE_SHADOW_START_SCRIPTS=0");
console.log("MOBILE_SHADOW_NX_RUNTIME_TARGETS=0");
console.log("MOBILE_METRO_PORT_AUTHORITY=CANONICAL_ENV");
console.log("MOBILE_CONFIG=PASS apps=" + apps.join(","));
