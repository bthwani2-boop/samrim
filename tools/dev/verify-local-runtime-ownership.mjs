import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));
const assert = (ok, message) => { if (!ok) failures.push(message); };

const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};
const runtime = read("tools/dev/runtime.ps1");
const mobile = read("tools/dev/open-mobile-apps.ps1");
const control = read("tools/dev/run-control.ps1");
const device = read("tools/dev/device-policy.psm1");
const scrcpy = read("tools/dev/scrcpy.ps1");
const compose = read("infra/local/compose/compose.yaml");

const runtimeScripts = {
  "runtime:up": "Up",
  "runtime:down": "Down",
  "runtime:status": "Status",
  "runtime:logs": "Logs",
  "runtime:doctor": "Doctor",
  "runtime:reset": "Reset",
  "runtime:rebuild": "Rebuild",
};
for (const [name, action] of Object.entries(runtimeScripts)) {
  assert(scripts[name] === `pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/runtime.ps1 -Action ${action}`, `${name} must route directly to runtime.ps1`);
}
for (const retired of ["runtime:restart","runtime:purge","runtime:restart-service","runtime:logs-service"]) {
  assert(scripts[retired] === undefined, `retired runtime command remains: ${retired}`);
}

const hostScripts = {
  control: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/run-control.ps1",
  client: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-client",
  partner: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-partner",
  captain: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-captain",
  field: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-field",
  scr: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/scrcpy.ps1",
};
for (const [name, command] of Object.entries(hostScripts)) {
  assert(scripts[name] === command, `${name} must be the exact canonical host command`);
}

assert(!exists("tools/dev/runtime.psm1"), "retired runtime.psm1 must be deleted");
assert(runtime.includes("ValidateSet('Up','Down','Status','Logs','Doctor','Reset','Rebuild')"), "runtime action surface must remain minimal");
assert(runtime.includes("RUNTIME_UP=PASS scope=backend"), "runtime up must remain backend-only");
assert(runtime.includes("RUNTIME_DOCTOR=PASS"), "runtime doctor must remain explicit deep backend proof");
assert(!runtime.includes("next dev") && !runtime.includes("expo start") && !runtime.includes("adb "), "Docker runtime must not own host apps or devices");

for (const service of ["postgres","mailpit","identity-migrate","identity","dsh-migrate","dsh"]) {
  assert(new RegExp(`^  ${service}:\\s*$`, "m").test(compose), `Compose missing backend service: ${service}`);
}
for (const forbidden of ["control:","metro-client:","metro-partner:","metro-captain:","metro-field:","js-deps:","/workspace","samrim-js-"]) {
  assert(!compose.includes(forbidden), `Compose retains application runtime residue: ${forbidden}`);
}

assert(control.includes("CONTROL_PANEL_REUSE=PASS"), "Control must reuse a healthy existing server");
assert(control.includes("next dev -H 127.0.0.1"), "Control must bind directly to Windows loopback");
assert(!control.includes("-Action Doctor") && !control.includes("docker "), "Control hot path must not invoke Docker diagnostics");

assert(mobile.includes("Get-MetroState -Port $metroPort"), "mobile hot path must inspect Metro before cold setup");
assert(mobile.includes("METRO_REUSE=PASS"), "healthy Metro must be reused");
assert(mobile.includes("exec expo start --dev-client --localhost --android --scheme"), "cold mobile path must delegate Metro lifecycle to Expo");
assert(mobile.includes("EXPO_NO_TYPESCRIPT_SETUP='1'"), "Expo TypeScript auto-setup must stay out of daily startup");
assert(mobile.includes("--dns-result-order=ipv4first"), "Windows Metro localhost must remain IPv4-first");
assert(!mobile.includes("-Action Doctor") && !mobile.includes("docker "), "mobile hot path must not invoke Docker diagnostics");

assert(device.includes("Get-UsbAdbDevice"), "device policy must be USB-only");
assert(device.includes("Ensure-AdbReverse"), "device policy must own required ADB reverse mappings");
for (const forbidden of ["PrepareWifiFallback","Find-DeviceByIdentity","adb tcpip","getprop","WIFI","wifi"]) {
  assert(!device.includes(forbidden), `device policy retains removed Wi-Fi/fallback complexity: ${forbidden}`);
}

assert(scrcpy.includes("Get-UsbAdbDevice"), "scrcpy must use the USB device owner");
for (const forbidden of ["Ensure-AdbReverse","while ($true)","WIFI","wifi","EnvPath"]) {
  assert(!scrcpy.includes(forbidden), `scrcpy retains removed orchestration: ${forbidden}`);
}

const canonicalEnvTemplate = ["infra","local",".env.example"].join("/");
const retiredEnv = ["infra","local","compose",".env"].join("/");
const retiredEnvTemplate = ["infra","local","compose",".env.example"].join("/");
assert(exists(canonicalEnvTemplate), "canonical local environment template is missing");
for (const retired of [retiredEnvTemplate,"infra/local/docker/js-runtime.Dockerfile","tools/dev/js-deps.mjs"]) {
  assert(!exists(retired), `retired runtime artifact remains: ${retired}`);
}

const trackedFiles = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const staleEnvReferences = [];
for (const trackedFile of trackedFiles) {
  const absolute = path.join(root, trackedFile);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const retired of [retiredEnv, retiredEnvTemplate]) {
    if (text.includes(retired) || text.includes(retired.replaceAll("/", "\\"))) staleEnvReferences.push(`${trackedFile} -> ${retired}`);
  }
}
assert(staleEnvReferences.length === 0, `retired local environment reference remains: ${[...new Set(staleEnvReferences)].join(", ")}`);

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("DOCKER_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("HOST_CONTROL_OWNER=tools/dev/run-control.ps1");
console.log("HOST_MOBILE_OWNER=tools/dev/open-mobile-apps.ps1");
console.log("USB_DEVICE_OWNER=tools/dev/device-policy.psm1");
console.log("DOCKER_JS_APPLICATION_SERVICES=0");
console.log("PARALLEL_RUNTIME_MODE=0");
