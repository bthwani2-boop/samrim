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
for (const [name, app] of [["client","app-client"],["partner","app-partner"],["captain","app-captain"],["field","app-field"]]) {
  assert(scripts[name]?.includes(`open-mobile-apps.ps1 -App ${app}`), `${name} must route through the canonical Windows Metro owner`);
}
assert(scripts.control?.includes("tools/dev/run-control.ps1"), "control must route through the canonical Windows Control owner");

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
assert(control.includes("-Action Doctor"), "Control host must fail closed unless the Docker backend is ready");
assert(control.includes("infra\\local\\.env"), "Control host must use the canonical shared local environment");

assert(mobile.includes("'expo','start','--dev-client','--host','localhost'"), "Metro must run directly on the Windows host with localhost transport");
assert(mobile.includes("-Action Doctor"), "mobile host must fail closed unless the Docker backend is ready");
assert(mobile.includes("Prepare-CanonicalAdbDevice"), "mobile host must retain the canonical device policy");
assert(mobile.includes("METRO_REUSE=PASS"), "mobile host must reuse an already-valid Metro process");
assert(mobile.includes("infra\\local\\.env"), "mobile host must use the canonical shared local environment");

assert(exists("infra/local/.env.example"), "canonical local environment template must live at infra/local/.env.example");
for (const retired of ["infra/local/compose/.env.example","infra/local/docker/js-runtime.Dockerfile","tools/dev/js-deps.mjs"]) {
  assert(!exists(retired), `retired runtime artifact remains: ${retired}`);
}

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
