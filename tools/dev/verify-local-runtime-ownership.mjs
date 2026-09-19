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
const runtimeEntrypoint = read("tools/dev/runtime.ps1");
const runtime = read("tools/dev/runtime.psm1");
const mobile = read("tools/dev/open-mobile-apps.ps1");
const control = read("tools/dev/run-control.ps1");
const scrcpy = read("tools/dev/scrcpy.ps1");
const compose = read("infra/local/compose/compose.yaml");

for (const [name, action] of [["runtime:up","Up"],["runtime:doctor","Doctor"],["runtime:status","Status"],["runtime:down","Down"],["runtime:restart","Restart"],["runtime:logs","Logs"],["runtime:reset","Reset"],["runtime:purge","Purge"],["runtime:rebuild","Rebuild"],["runtime:restart-service","RestartService"],["runtime:logs-service","LogsService"]]) {
  assert(scripts[name]?.includes(`tools/dev/runtime.ps1 -Action ${action}`), `${name} must route through the canonical Docker backend runtime owner`);
}
const canonicalHostScripts = {
  control: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/run-control.ps1",
  client: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-client",
  partner: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-partner",
  captain: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-captain",
  field: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/open-mobile-apps.ps1 -App app-field",
};
for (const [name, command] of Object.entries(canonicalHostScripts)) {
  assert(scripts[name] === command, `${name} must be the exact canonical host runtime command`);
}

assert(runtimeEntrypoint.includes("runtime.psm1") && runtimeEntrypoint.includes("Invoke-SamrimRuntime @PSBoundParameters"), "runtime.ps1 must remain a thin backend lifecycle entrypoint");
for (const forbidden of ["Control","Surface"]) assert(!runtimeEntrypoint.includes(`'${forbidden}'`), `runtime entrypoint must not own host application action ${forbidden}`);

for (const service of ["postgres","mailpit","identity-migrate","identity","dsh-migrate","dsh"]) {
  assert(new RegExp(`^  ${service}:\\s*$`, "m").test(compose), `Compose missing canonical backend service: ${service}`);
}
for (const forbidden of ["control:","metro-client:","metro-partner:","metro-captain:","metro-field:","js-deps:","/workspace","samrim-js-","js-runtime.Dockerfile"]) {
  assert(!compose.includes(forbidden), `Compose retains deleted JavaScript runtime residue: ${forbidden}`);
}
assert(/^name:\s*samrim-local\s*$/m.test(compose), "Compose project must remain samrim-local");
assert((compose.match(/interval: 30s/g) ?? []).length === 3, "backend healthchecks must retain the quiet steady-state interval");
assert((compose.match(/start_interval: 2s/g) ?? []).length === 3, "backend healthchecks must retain fast startup probing");

assert(runtime.includes("$AllowedServices = @('identity','dsh')"), "Docker targeted service interface must admit backend services only");
assert(runtime.includes("DOCKER_BACKEND_RUNTIME=PASS"), "runtime must expose backend-only Docker ownership");
assert(runtime.includes("APPLICATION_RUNTIME=HOST_OWNED"), "runtime must expose host application ownership");
assert(runtime.includes("CANONICAL_RUNTIME_READBACK=PASS scope=backend-compose"), "runtime doctor must prove the backend compose cone");
for (const forbidden of ["WorkspaceServices","Assert-WorkspaceMounts","js-deps","metro-client","metro-partner","metro-captain","metro-field","next dev","expo start"]) {
  assert(!runtime.includes(forbidden), `Docker runtime retains host-application residue: ${forbidden}`);
}

assert(control.includes("next dev -H 127.0.0.1"), "Control Panel must run directly on the Windows host loopback");
assert(control.includes("CONTROL_PANEL_HOST=START url=$publicOrigin bind=127.0.0.1:$port"), "Control must expose localhost as the canonical browser origin while retaining loopback-only binding");
assert(control.includes("-Action Doctor"), "Control host must fail closed unless the Docker backend is ready");
assert(control.includes("Get-ControlState -Port $port"), "Control reuse must prove same-repository Next process-tree ownership before reusing port 13000");
assert(control.includes("CONTROL_STALE_PROCESS=REMOVED"), "Control must self-heal only stale same-repository Next residue");
assert(control.includes("CONTROL_PORT_IN_USE"), "Control must fail closed when port 13000 belongs to another process");
assert(control.includes("infra\\local\\.env"), "Control host must use the canonical shared local environment");

assert(mobile.includes("exec expo start --dev-client --localhost --android --scheme"), "mobile host must delegate Metro lifecycle and Android launch directly to Expo CLI");
assert(mobile.includes("-Action Doctor"), "mobile host must fail closed unless the Docker backend is ready");
assert(mobile.includes("Prepare-CanonicalAdbDevice"), "mobile host must retain the canonical device policy");
assert(mobile.includes("Ports @($identityPort,$dshPort)"), "mobile host must leave Metro reverse ownership to Expo and prepare backend reverse ports only");
assert(!/SAMRIM_APP_(?:CLIENT|PARTNER|CAPTAIN|FIELD)_METRO_PORT/.test(read("tools/dev/device-policy.psm1")), "device policy must not own Metro reverse ports; Expo owns the selected Metro port");
assert(scrcpy.includes("Get-CanonicalBackendReversePorts"), "scrcpy failover must restore backend reverse ports only");
assert(!scrcpy.includes("Get-CanonicalReversePorts"), "retired all-port reverse ownership must not survive in scrcpy");
assert(mobile.includes("$env:ANDROID_SERIAL=[string]$device.Serial"), "Expo must target the canonical device selected by device policy");
assert(mobile.includes("--dns-result-order=ipv4first"), "Windows Metro localhost resolution must remain IPv4-first so Expo's 127.0.0.1 native URL and the bound listener cannot diverge");
assert(mobile.includes("Get-SameAppMetroState -Port $metroPort -AppName $App"), "mobile startup must classify same-app Metro ownership before deciding reuse or restart");
assert(mobile.includes("METRO_REUSE=PASS"), "healthy same-app Metro must be reused for fast idempotent daily startup");
assert(mobile.includes("MOBILE_OPEN=PASS app=$AppName mode=reuse"), "mobile reuse must reopen the installed development client without restarting Metro");
assert(mobile.includes("METRO_STALE_PROCESS=REMOVED"), "unhealthy same-app Metro must be removed before canonical restart");
assert(mobile.includes("METRO_PORT_IN_USE"), "occupied Metro ports must fail closed when ownership is not exactly proven");
assert(mobile.includes("infra\\local\\.env"), "mobile host must use the canonical shared local environment");
for (const forbidden of ["Start-Process","Metro-Ready","METRO_START_TIMEOUT","EXPO_PACKAGER_PROXY_URL","Stop-ProcessTree"]) {
  assert(!mobile.includes(forbidden), `mobile host retains superseded orchestration residue: ${forbidden}`);
}

const canonicalEnvTemplate = ["infra","local",".env.example"].join("/");
const retiredRuntimeEnv = ["infra","local","compose",".env"].join("/");
const retiredEnvTemplate = ["infra","local","compose",".env.example"].join("/");
assert(exists(canonicalEnvTemplate), `canonical local environment template must live at ${canonicalEnvTemplate}`);
for (const retired of [retiredEnvTemplate,"infra/local/docker/js-runtime.Dockerfile","tools/dev/js-deps.mjs"]) {
  assert(!exists(retired), `retired runtime artifact remains: ${retired}`);
}

const retiredEnvReferences = [retiredRuntimeEnv, retiredEnvTemplate];
const trackedFiles = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const staleEnvReferences = [];
for (const trackedFile of trackedFiles) {
  const absolutePath = path.join(root, trackedFile);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const retired of retiredEnvReferences) {
    const windowsRetired = retired.replaceAll("/", "\\");
    if (text.includes(retired) || text.includes(windowsRetired)) {
      staleEnvReferences.push(`${trackedFile} -> ${retired}`);
    }
  }
}
assert(
  staleEnvReferences.length === 0,
  `retired local environment path reference remains in tracked text: ${[...new Set(staleEnvReferences)].sort().join(", ")}`,
);

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("DOCKER_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("HOST_CONTROL_OWNER=tools/dev/run-control.ps1");
console.log("HOST_MOBILE_OWNER=tools/dev/open-mobile-apps.ps1");
console.log("DOCKER_JS_APPLICATION_SERVICES=0");
console.log("PARALLEL_RUNTIME_MODE=0");
