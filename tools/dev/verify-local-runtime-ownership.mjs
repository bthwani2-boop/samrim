import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));
const assert = (condition, message) => { if (!condition) failures.push(message); };

function parseEnv(text, label) {
  const map = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) { failures.push(`${label} contains malformed environment line: ${rawLine}`); continue; }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (map.has(key)) failures.push(`${label} contains duplicate key: ${key}`);
    map.set(key, value);
  }
  return map;
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

const packageJson = JSON.parse(read("package.json"));
const scripts = packageJson.scripts ?? {};
const runtimePath = "tools/dev/runtime.ps1";
const devicePath = "tools/dev/device-policy.psm1";
const scrcpyPath = "tools/dev/scrcpy.ps1";
const appOpenerPath = "tools/dev/open-mobile-apps.ps1";
const runtime = read(runtimePath);
const device = read(devicePath);
const scrcpy = read(scrcpyPath);
const opener = read(appOpenerPath);
const compose = read("infra/local/compose/compose.yaml");
const env = parseEnv(read("infra/local/compose/.env.example"), ".env.example");

assert(exists(runtimePath), `missing runtime owner: ${runtimePath}`);
assert(exists(devicePath), `missing device policy owner: ${devicePath}`);
assert(exists(scrcpyPath), `missing mirror consumer: ${scrcpyPath}`);
assert(exists(appOpenerPath), `missing app opener: ${appOpenerPath}`);
assert(scripts["runtime:up"]?.includes(`${runtimePath} -Action Up`), "runtime:up must route to Docker runtime startup");
assert(!scripts["runtime:up"]?.includes(appOpenerPath), "runtime:up must not open Android applications");
assert(scripts.client?.includes(appOpenerPath) && scripts.partner?.includes(appOpenerPath) && scripts.captain?.includes(appOpenerPath) && scripts.field?.includes(appOpenerPath), "each app command must route to the app opener");
assert(scripts.scr?.includes(scrcpyPath), "scr must route to the display-only scrcpy consumer");
assert(scripts["runtime:mobile-lan"] === undefined, "retired Mobile LAN runtime command must not survive");
for (const [name, action] of [["runtime:down", "Down"], ["runtime:restart", "Restart"], ["runtime:status", "Status"], ["runtime:logs", "Logs"], ["runtime:doctor", "Doctor"], ["runtime:reset", "Reset"], ["runtime:purge", "Purge"], ["runtime:rebuild", "Rebuild"], ["runtime:restart-service", "RestartService"], ["runtime:logs-service", "LogsService"]]) {
  assert(scripts[name]?.includes(`${runtimePath} -Action ${action}`), `${name} must route to the canonical runtime owner`);
}

assert(/^name:\s*samrim-local\s*$/m.test(compose), "Compose project must be samrim-local");
assert(!compose.includes("profiles:"), "canonical Compose must not expose alternate runtime profiles");
assert(!compose.includes("SAMRIM_HOTSPOT_IP"), "Compose must not depend on a hotspot address");
for (const service of ["postgres", "mailpit", "identity-migrate", "identity", "dsh-migrate", "dsh", "js-deps", "control", "metro-client", "metro-partner", "metro-captain", "metro-field"]) {
  assert(new RegExp(`^  ${service}:\\s*$`, "m").test(compose), `canonical Compose missing service: ${service}`);
}
const portKeys = ["SAMRIM_MAILPIT_WEB_PORT", "SAMRIM_IDENTITY_PORT", "SAMRIM_DSH_PORT", "SAMRIM_CONTROL_PORT", "SAMRIM_APP_CLIENT_METRO_PORT", "SAMRIM_APP_PARTNER_METRO_PORT", "SAMRIM_APP_CAPTAIN_METRO_PORT", "SAMRIM_APP_FIELD_METRO_PORT"];
const portValues = portKeys.map((key) => Number(env.get(key)));
assert(portValues.every((value) => Number.isInteger(value) && value >= 1 && value <= 65535), "all canonical runtime ports must be valid");
assert(new Set(portValues).size === portValues.length, "canonical runtime ports must be unique");

assert(runtime.includes("$CanonicalProject = 'samrim-local'"), "runtime must use the canonical Docker project");
assert(runtime.includes("function Start-CanonicalRuntime"), "runtime must own Docker startup");
assert(runtime.includes("function Assert-CanonicalRuntime"), "runtime must own Docker readback");
assert(!/\badb\b/i.test(runtime), "runtime lifecycle must not contain device policy");
assert(!/\b(?:next\s+dev|expo\s+start|go\s+run)\b/i.test(runtime), "runtime must not launch native server or Metro shadows");
assert(!functionBody(runtime, "Stop-CanonicalRuntime").includes("Ensure-Environment"), "runtime down must not reconcile environment");
assert(!functionBody(runtime, "Show-RuntimeLogs").includes("Ensure-Environment"), "runtime logs must be read-only");
assert(!functionBody(runtime, "Show-RuntimeStatus").includes("Ensure-Environment"), "runtime status must be read-only");
assert(!functionBody(runtime, "Invoke-RuntimeDoctor").includes("Ensure-Environment"), "runtime doctor must be read-only");
assert(!functionBody(runtime, "Reset-CanonicalRuntime").includes("Ensure-Environment"), "runtime reset must not reconcile environment");
assert(!functionBody(runtime, "Purge-CanonicalRuntime").includes("Ensure-Environment"), "runtime purge must not reconcile environment");

for (const marker of ["Get-AdbCensus", "Get-CanonicalAdbDevice", "Ensure-CanonicalAdbReverse", "Prepare-CanonicalAdbDevice", "Find-DeviceByIdentity"]) assert(device.includes(marker), `device policy owner missing capability: ${marker}`);
assert(device.includes("BTHWANI_ADB_SERIAL"), "device policy must support an explicit serial override");
assert(device.includes("Group-Object"), "device policy must group transports by physical identity");
assert(device.includes("tcpip 5555"), "device policy must own bounded Wi-Fi fallback bootstrap");
assert(device.includes("reverse --list"), "device policy must own reverse readback");
assert(scrcpy.includes("device-policy.psm1"), "scrcpy must consume the canonical device policy");
assert(scrcpy.includes("SCRCPY_ROLE=MIRROR_ONLY"), "scrcpy must remain a display-only consumer");
assert(!/\badb\s+[^\r\n]*\breverse\b/i.test(scrcpy), "scrcpy must not own reverse preparation");
assert(!/\badb\s+[^\r\n]*\breverse\b/i.test(opener), "app opener must not own reverse preparation");
assert(opener.includes("device-policy.psm1"), "app opener must consume the canonical device policy");
assert(opener.includes("Read-AppConfig"), "app opener must read app-owned mobile configuration");
assert(!/com\.bthwani\.|bthwani-(?:client|partner|captain|field)-next|projectId/i.test(opener + scrcpy + runtime + device), "tooling must not mirror deployable mobile identities");

const appConfigValues = [];
for (const entry of fs.readdirSync(path.join(repoRoot, "apps"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const configPath = path.join(repoRoot, "apps", entry.name, "mobile.config.json");
  if (!fs.existsSync(configPath)) continue;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  for (const field of ["scheme", "androidPackage", "iosBundleIdentifier", "slug", "projectId"]) appConfigValues.push([field, config[field]]);
}
for (const [field, value] of appConfigValues) {
  assert(!opener.includes(value), `app opener must derive ${field} from mobile.config.json`);
  assert(!scrcpy.includes(value), `scrcpy must not mirror ${field}`);
  assert(!runtime.includes(value), `runtime must not mirror ${field}`);
}

for (const file of [runtimePath, devicePath, scrcpyPath, appOpenerPath, "infra/local/compose/compose.yaml"]) {
  const body = read(file);
  assert(!/MobileLan|MOBILE_LAN|SAMRIM_HOTSPOT_IP|portproxy|Get-NetFirewall|WIFI_LAN|runtime:mobile-lan/i.test(body), `retired Mobile LAN residue remains in ${file}`);
}

if (failures.length > 0) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("DOCKER_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("DEVICE_POLICY_OWNER=tools/dev/device-policy.psm1");
console.log("ANDROID_MIRROR_CONSUMER=tools/dev/scrcpy.ps1");
console.log("ANDROID_APP_OPENER=tools/dev/open-mobile-apps.ps1");
console.log("ANDROID_DATA_PATH=ADB_REVERSE");
console.log("MOBILE_LAN_RUNTIME_RESIDUE=0");
