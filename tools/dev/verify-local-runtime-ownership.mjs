import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (ok, message) => { if (!ok) failures.push(message); };

const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};
const runtime = read("tools/dev/runtime.ps1");
const opener = read("tools/dev/open-mobile-apps.ps1");
const candidate = read("tools/dev/verify-local-candidate.ps1");
const compose = read("infra/local/compose/compose.yaml");

const destructiveGuard = "if ($Action -in @('Reset','Purge') -and -not $AllowDataLoss)";
assert(runtime.includes("[switch]$AllowDataLoss"), "destructive runtime actions must require an explicit same-invocation authorization switch");
assert(runtime.includes(destructiveGuard), "destructive runtime actions must fail closed without authorization");
assert(runtime.includes("rerun_same_invocation_with=-AllowDataLoss"), "destructive runtime refusal must name the explicit authorization interface");
assert(runtime.indexOf(destructiveGuard) < runtime.indexOf("switch ($Action)"), "destructive authorization must be checked before any runtime action dispatch");

for (const [name, action] of [
  ["runtime:up", "Up"],
  ["runtime:doctor", "Doctor"],
  ["runtime:status", "Status"],
]) {
  assert(
    scripts[name]?.includes(`tools/dev/runtime.ps1 -Action ${action}`),
    `${name} must route to the canonical full-stack runtime owner`,
  );
}

for (const [name, action] of [
  ["runtime:down", "Down"],
  ["runtime:restart", "Restart"],
  ["runtime:logs", "Logs"],
  ["runtime:reset", "Reset"],
  ["runtime:purge", "Purge"],
  ["runtime:rebuild", "Rebuild"],
  ["runtime:restart-service", "RestartService"],
  ["runtime:logs-service", "LogsService"],
]) {
  assert(
    scripts[name]?.includes(`tools/dev/runtime.ps1 -Action ${action}`),
    `${name} must route to tools/dev/runtime.ps1`,
  );
}

for (const [name, app] of [
  ["client", "app-client"],
  ["partner", "app-partner"],
  ["captain", "app-captain"],
  ["field", "app-field"],
]) {
  assert(
    scripts[name]?.includes(`open-mobile-apps.ps1 -App ${app}`),
    `${name} must route through the canonical mobile opener`,
  );
}
assert(scripts.control?.includes("tools/dev/runtime.ps1 -Action Control"), "control must route through runtime.ps1");

const services = [
  "postgres",
  "mailpit",
  "identity-migrate",
  "identity",
  "dsh-migrate",
  "dsh",
  "js-deps",
  "control",
  "metro-client",
  "metro-partner",
  "metro-captain",
  "metro-field",
];
for (const service of services) {
  assert(new RegExp(`^  ${service}:\\s*$`, "m").test(compose), `Compose missing canonical service: ${service}`);
}

assert(/^name:\s*samrim-local\s*$/m.test(compose), "Compose project must be samrim-local");
assert(compose.includes("- ../../..:/workspace"), "Compose JavaScript services must bind the repository root to /workspace");
assert(!compose.includes("profiles:"), "parallel Compose profiles are forbidden");
assert(!/js-deps:\s*[\s\S]*?pull_policy:\s*build/.test(compose), "js-deps must not force image builds during routine runtime startup");
assert(!/\bgo\s+run\b/i.test(runtime), "runtime.ps1 must not create host-native Go runtime paths");
assert(!/\b(?:next\s+dev|expo\s+start)\b/i.test(runtime), "runtime.ps1 must not create host-native JS runtime paths");

for (const token of [
  "CANONICAL_LOCAL_RUNTIME=PASS mode=full",
  "RUNTIME_STATUS=READ_ONLY scope=full-canonical-compose",
  "CANONICAL_RUNTIME_READBACK=PASS scope=full-canonical-compose",
  "Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')",
]) {
  assert(runtime.includes(token), `full runtime contract missing: ${token}`);
}

assert(
  !runtime.includes("Compose @('up','-d','--build','--wait','--wait-timeout','300','--remove-orphans')"),
  "runtime:up must not rebuild the full stack by default",
);

assert(runtime.includes("function Get-Running-Workspace-Services"), "runtime:up must read running workspace services before dependency materialization");
assert(runtime.includes("function Test-Js-Dependencies-Ready"), "runtime:up must retain one read-only dependency readiness check");
assert(runtime.includes("function Start-Full-Runtime"), "runtime must have one canonical full-stack startup owner");
assert(!runtime.includes("function Start-Requested-Runtime"), "target runtime startup orchestration must not survive the daily full-stack cutover");
assert(!runtime.includes("function Ensure-Target-Runtime"), "app/control helpers must not own target runtime startup");
assert(runtime.includes("$dependenciesReady = Test-Js-Dependencies-Ready"), "full startup must gate shared dependency materialization");
assert(runtime.includes("JS_DEPS_GATE=READY action=no-stop scope=full"), "ready dependencies must preserve running workspace services");
assert(runtime.includes("JS_DEPS_GATE=STALE action=stop-materialize scope=full"), "stale dependencies must expose the full-start materialization boundary");
assert(runtime.includes("if ($runningBefore.Count -gt 0) { Compose (@('stop') + $runningBefore) }"), "stale dependency materialization must stop only currently running workspace services");
assert(!runtime.includes("JS_DEPS_GATE=RESTORE"), "retired target-start restore orchestration must not survive");
assert(runtime.includes("$WorkspaceServices = @('control','metro-client','metro-partner','metro-captain','metro-field')"), "workspace-bound JavaScript services must have one canonical runtime set");
assert(runtime.includes("Assert-WorkspaceMounts"), "runtime readback must verify the repository bind mount for every workspace-bound service");
assert(runtime.includes("target=/workspace"), "runtime workspace readback must identify the canonical /workspace target");
assert(runtime.includes("DOCKER_WORKSPACE_MOUNTS=PASS source=repository-root target=/workspace"), "runtime status must expose workspace bind readback");
assert(
  opener.includes("-Action Surface -Surface $surface"),
  "mobile opener must use the canonical read-only surface assertion",
);
assert(!opener.includes("docker compose") && !opener.includes("Compose @("), "mobile opener must not own Docker lifecycle");

const controlCase = runtime.match(/'Control'\s*\{([\s\S]*?)\n\s*\}\n\s*'Surface'/)?.[1] ?? "";
const surfaceCase = runtime.match(/'Surface'\s*\{([\s\S]*?)\n\s*\}\n\s*'Rebuild'/)?.[1] ?? "";
assert(controlCase.includes("Read-CanonicalEnvironment") && controlCase.includes("Assert-Target-Runtime"), "control helper must read/validate the existing runtime");
assert(surfaceCase.includes("Read-CanonicalEnvironment") && surfaceCase.includes("Assert-Target-Runtime"), "surface helper must read/validate the existing runtime");
assert(!controlCase.includes("Compose @(") && !surfaceCase.includes("Compose @("), "control/surface helpers must not mutate Compose lifecycle");
assert(runtime.includes("CONTROL_PANEL_READY=PASS mode=read-only"), "control helper must expose read-only semantics");
assert(runtime.includes("MOBILE_SURFACE_RUNTIME=PASS mode=read-only"), "surface helper must expose read-only semantics");

for (const forbidden of [for (const forbidden of [
  "runtime:up",
  "runtime:doctor",
  "runtime:status",
  "Get-RuntimeSnapshot",
  "Restore-RuntimeSnapshot",
  "PREEXISTING_RUNTIME_MODE",
]) {
  assert(!candidate.includes(forbidden), `candidate verifier must not own runtime lifecycle: ${forbidden}`);
}

assert(candidate.includes("nx affected"), "candidate verifier must use affected project execution");
assert(!scripts["runtime:surface"], "surface lifecycle must remain internal instead of adding a public command");
assert(!scripts["runtime:mobile-lan"], "retired mobile LAN runtime command must not return");

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("DOCKER_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("FULL_RUNTIME_COMMANDS=runtime:up,runtime:doctor,runtime:status");
console.log("TARGET_RUNTIME_STOPS_UNRELATED_SURFACES=0");
console.log("CANDIDATE_VERIFIER_OWNS_RUNTIME=0");
console.log("ROUTINE_JS_IMAGE_FORCE_BUILD=0");
