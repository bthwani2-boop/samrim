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

const packageJson = JSON.parse(read("package.json"));
const scripts = packageJson.scripts ?? {};
const runtimeOwner = "tools/dev/runtime.ps1";
const deviceOwner = "tools/dev/scrcpy.ps1";
const pwshPrefix = `pwsh -NoProfile -ExecutionPolicy Bypass -File ${runtimeOwner} -Action `;

const expectedRuntimeScripts = new Map([
  ["runtime:up", `${pwshPrefix}Up`],
  ["runtime:down", `${pwshPrefix}Down`],
  ["runtime:restart", `${pwshPrefix}Restart`],
  ["runtime:status", `${pwshPrefix}Status`],
  ["runtime:logs", `${pwshPrefix}Logs`],
  ["runtime:doctor", `${pwshPrefix}Doctor`],
  ["runtime:reset", `${pwshPrefix}Reset`],
  ["runtime:purge", `${pwshPrefix}Purge`],
]);
for (const [name, expected] of expectedRuntimeScripts) assert(scripts[name] === expected, `${name} must route directly to ${runtimeOwner}`);
assert(scripts["runtime:mobile-lan"] === undefined, "retired runtime:mobile-lan command must not survive");
assert(scripts["runtime:verify-ownership"] === "node tools/dev/verify-local-runtime-ownership.mjs", "runtime ownership verifier command drifted");
for (const [name, action] of [["control","Control"],["client","Client"],["partner","Partner"],["captain","Captain"],["field","Field"]]) assert(scripts[name] === `${pwshPrefix}${action}`, `${name} must route directly to ${runtimeOwner}`);
assert(scripts.scr === `pwsh -NoProfile -ExecutionPolicy Bypass -File ${deviceOwner}`, `scr must route directly to ${deviceOwner}`);
assert(exists(runtimeOwner), `canonical runtime owner is missing: ${runtimeOwner}`);
assert(exists(deviceOwner), `canonical device owner is missing: ${deviceOwner}`);

const compose = read("infra/local/compose/compose.yaml");
const envMap = parseEnv(read("infra/local/compose/.env.example"), ".env.example");
assert(/^name:\s*samrim-local\s*$/m.test(compose), "Compose project must be samrim-local");
assert(!compose.includes("profiles:"), "canonical Compose must not expose alternate profiles");
assert(!compose.includes("SAMRIM_HOTSPOT_IP"), "Compose must not project a hotspot IP");
assert((compose.match(/EXPO_PACKAGER_PROXY_URL:\s*"http:\/\/127\.0\.0\.1:/g) ?? []).length === 4, "all four Metro services must advertise device loopback");
assert((compose.match(/EXPO_PUBLIC_IDENTITY_API_URL:\s*"http:\/\/127\.0\.0\.1:/g) ?? []).length === 4, "all four Metro services must advertise Identity through device loopback");
assert((compose.match(/EXPO_PUBLIC_DSH_API_URL:\s*"http:\/\/127\.0\.0\.1:/g) ?? []).length === 4, "all four Metro services must advertise DSH through device loopback");
for (const service of ["postgres","mailpit","identity-migrate","identity","dsh-migrate","dsh","js-deps","control","metro-client","metro-partner","metro-captain","metro-field"]) assert(new RegExp(`^  ${service}:\\s*$`, "m").test(compose), `canonical Compose missing service: ${service}`);
for (const key of ["SAMRIM_MAILPIT_WEB_PORT","SAMRIM_IDENTITY_PORT","SAMRIM_DSH_PORT","SAMRIM_CONTROL_PORT","SAMRIM_APP_CLIENT_METRO_PORT","SAMRIM_APP_PARTNER_METRO_PORT","SAMRIM_APP_CAPTAIN_METRO_PORT","SAMRIM_APP_FIELD_METRO_PORT"]) { const value = Number(envMap.get(key)); assert(Number.isInteger(value) && value >= 1 && value <= 65535, `invalid canonical runtime port ${key}`); }
assert(envMap.get("EXPO_PUBLIC_IDENTITY_API_URL") === envMap.get("IDENTITY_API_BASE_URL"), "mobile Identity URL must project canonical localhost Identity URL");
assert(envMap.get("EXPO_PUBLIC_DSH_API_URL") === envMap.get("DSH_API_BASE_URL"), "mobile DSH URL must project canonical localhost DSH URL");

const runtime = read(runtimeOwner);
const device = read(deviceOwner);
for (const marker of ["$CanonicalProject = 'samrim-local'","function Ensure-Environment","function Start-CanonicalRuntime","function Assert-CanonicalRuntime","function Assert-AdbReverseReady","DOCKER_OWNS=postgres,mailpit,identity,dsh,control,metro-client,metro-partner,metro-captain,metro-field","ANDROID_DEVICE_OWNER=pnpm_scr","ANDROID_DATA_PATH=ADB_REVERSE","MOBILE_TRANSPORT=ADB_REVERSE","CONTROL_PANEL_OWNER=DOCKER"]) assert(runtime.includes(marker), `canonical runtime owner missing invariant: ${marker}`);
for (const forbidden of ["MobileLan","MOBILE_LAN","SAMRIM_HOTSPOT_IP","BThwani Samrim Mobile LAN","Get-NetFirewall","portproxy","ADB_REVERSE_DEPENDENCY=0","MOBILE_TRANSPORT=WIFI_LAN","runtime:mobile-lan"]) { assert(!runtime.includes(forbidden), `retired runtime residue survived: ${forbidden}`); assert(!device.includes(forbidden), `retired device residue survived: ${forbidden}`); }
assert(!/['"]exec['"]\s*,\s*['"]expo['"]\s*,\s*['"]start['"]/.test(runtime), "runtime owner must not launch Metro natively");
assert(!/next\s+dev/.test(runtime), "runtime owner must not launch Next.js natively");
for (const marker of ["DEVICE_OWNER=WINDOWS","DEVICE_POLICY=USB_PRIMARY_WIFI_HOT_FALLBACK","ANDROID_DATA_PATH=ADB_REVERSE","ADB_USB_PRIMARY=PASS","ADB_WIFI_FALLBACK=PASS","CABLE_FAILOVER=ARMED","ADB_FAILOVER=PASS from=USB to=WIFI","Ensure-AdbReverse"]) assert(device.includes(marker), `canonical device owner missing invariant: ${marker}`);
assert(device.includes("adb -s $UsbSerial tcpip 5555"), "USB bootstrap must prepare Wi-Fi fallback explicitly");
assert(device.includes("scrcpy -s $Serial"), "scrcpy must target the selected transport explicitly");
const startRuntimeStart = runtime.indexOf("function Start-CanonicalRuntime");
const startRuntimeEnd = runtime.indexOf("function Ensure-CanonicalRuntime");
assert(startRuntimeStart >= 0 && startRuntimeEnd > startRuntimeStart && !runtime.slice(startRuntimeStart, startRuntimeEnd).includes("adb "), "runtime up must remain independent from Android device transport");

if (failures.length > 0) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("LOCAL_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("ANDROID_DEVICE_OWNER=tools/dev/scrcpy.ps1");
console.log("ANDROID_DATA_PATH=ADB_REVERSE");
console.log("ANDROID_USB_PRIMARY_WIFI_FALLBACK=PASS");
console.log("MOBILE_LAN_RUNTIME_RESIDUE=0");
