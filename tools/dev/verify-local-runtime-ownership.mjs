import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (ok, message) => { if (!ok) failures.push(message); };
const section = (start, end) => {
  const from = runtime.indexOf(start);
  const to = runtime.indexOf(end, from + start.length);
  return from >= 0 && to > from ? runtime.slice(from, to) : "";
};

const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};
const runtime = read("tools/dev/runtime.ps1");
const opener = read("tools/dev/open-mobile-apps.ps1");
const scrcpy = read("tools/dev/scrcpy.ps1");
const candidate = read("tools/dev/verify-local-candidate.ps1");
const compose = read("infra/local/compose/compose.yaml");
const dshDockerfile = read("services/dsh/backend/Dockerfile");
const dockerignore = read(".dockerignore");

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

assert((compose.match(/image: samrim-local-identity:dev/g) ?? []).length === 2, "identity runtime and migration must share one canonical image");
assert((compose.match(/image: samrim-local-dsh:dev/g) ?? []).length === 2, "DSH runtime and migration must share one canonical image");
assert(!compose.includes("samrim-local-identity-migrate:dev"), "duplicate Identity migration image tag must not return");
assert(!compose.includes("samrim-local-dsh-migrate:dev"), "duplicate DSH migration image tag must not return");
assert((compose.match(/dockerfile: services\/identity\/backend\/Dockerfile/g) ?? []).length === 1, "Identity backend image must have one Compose build owner");
assert((compose.match(/dockerfile: services\/dsh\/backend\/Dockerfile/g) ?? []).length === 1, "DSH backend image must have one Compose build owner");
assert(runtime.includes("Compose @('build','identity')"), "Identity targeted rebuild must build the canonical backend image once");
assert(runtime.includes("Compose @('build','dsh')"), "DSH targeted rebuild must build the canonical backend image once");
assert(!runtime.includes("Compose @('build','identity-migrate','identity')"), "duplicate Identity rebuild ownership must not return");
assert(!runtime.includes("Compose @('build','dsh-migrate','dsh')"), "duplicate DSH rebuild ownership must not return");

const dshManifestCopy = dshDockerfile.indexOf("COPY services/dsh/backend/go.mod services/dsh/backend/go.sum");
const dshIdentityManifestCopy = dshDockerfile.indexOf("COPY services/identity/clients/go/go.mod");
const dshDownload = dshDockerfile.indexOf("RUN go mod download");
const dshSourceCopy = dshDockerfile.indexOf("COPY services/dsh/backend ./services/dsh/backend");
assert(dshManifestCopy >= 0 && dshIdentityManifestCopy >= 0 && dshDownload > dshManifestCopy && dshDownload > dshIdentityManifestCopy, "DSH dependency manifests must precede go mod download");
assert(dshSourceCopy > dshDownload, "DSH implementation source must not invalidate the go mod download layer");

for (const ignored of ["apps/", "packages/", "tools/", ".github/", "infra/"]) {
  assert(dockerignore.split(/\r?\n/).includes(ignored), `backend root build context must exclude unrelated path: ${ignored}`);
}

assert(!/\bgo\s+run\b/i.test(runtime), "runtime.ps1 must not create host-native Go runtime paths");
assert(!/\b(?:next\s+dev|expo\s+start)\b/i.test(runtime), "runtime.ps1 must not create host-native JS runtime paths");

for (const token of [
  "CANONICAL_LOCAL_RUNTIME=PASS mode=full",
  "RUNTIME_STATUS=READ_ONLY scope=service-state-display",
  "CANONICAL_RUNTIME_READBACK=PASS scope=full-canonical-compose",
  "Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')",
]) {
  assert(runtime.includes(token), `full runtime contract missing: ${token}`);
}

assert(
  !runtime.includes("Compose @('up','-d','--build','--wait','--wait-timeout','300','--remove-orphans')"),
  "runtime:up must not rebuild the full stack by default",
);

assert(runtime.includes("function Get-CanonicalRuntimeSnapshot"), "runtime readback must have one canonical per-invocation Docker snapshot owner");
assert(!runtime.includes("function Container-Ids"), "per-service Docker ps readback must not survive the canonical snapshot cutover");
assert((runtime.match(/& docker ps/g) ?? []).length === 1, "runtime.ps1 must issue docker ps only through the canonical snapshot owner");
assert((runtime.match(/& docker inspect/g) ?? []).length === 1, "runtime.ps1 must batch docker inspect through the canonical snapshot owner");
assert(runtime.includes("LOCAL_RUNTIME_ENV=READY action=reuse"), "runtime startup must expose no-write environment reuse");
assert(runtime.includes("$existingText -cne $desired"), "runtime startup must not rewrite an unchanged local environment");
assert(runtime.includes("function Test-Full-RuntimeReady"), "runtime:up must prove an exact ready runtime before using the warm reconciliation path");
assert(runtime.includes("function Get-Running-Workspace-Services"), "runtime:up must read running workspace services before dependency materialization");
assert(runtime.includes("function Test-Js-Dependencies-Ready"), "runtime:up must retain one read-only dependency readiness check");
const jsDepsReadyCase = section("function Test-Js-Dependencies-Ready", "function Assert-HttpEndpoint");
assert(jsDepsReadyCase.includes("& docker exec"), "ready runtime dependency checks must reuse an already-running JavaScript container");
assert(jsDepsReadyCase.includes("Compose @('run','--rm','js-deps'"), "dependency readiness must retain a bootstrap/down-state fallback");
assert(jsDepsReadyCase.indexOf("& docker exec") < jsDepsReadyCase.indexOf("Compose @('run','--rm','js-deps'"), "running JavaScript ownership must be preferred before transient dependency-check containers");
assert(runtime.includes("function Start-Full-Runtime"), "runtime must have one canonical full-stack startup owner");
assert(!runtime.includes("function Start-Requested-Runtime"), "target runtime startup orchestration must not survive the daily full-stack cutover");
assert(!runtime.includes("function Ensure-Target-Runtime"), "app/control helpers must not own target runtime startup");
assert(runtime.includes("$dependenciesReady = Test-Js-Dependencies-Ready $before"), "full startup must gate shared dependency materialization from the canonical pre-start snapshot");
assert(!startupCase.includes("Compose @('config','--quiet')"), "runtime:up must not duplicate Compose parsing before the actual reconciliation command");
assert(runtime.includes("JS_DEPS_GATE=READY action=no-stop scope=full"), "ready dependencies must preserve running workspace services");
assert(runtime.includes("JS_DEPS_GATE=STALE action=stop-materialize scope=full"), "stale dependencies must expose the full-start materialization boundary");
assert(runtime.includes("if ($runningBefore.Count -gt 0) { Compose (@('stop') + $runningBefore) }"), "stale dependency materialization must stop only currently running workspace services");
assert(!runtime.includes("JS_DEPS_GATE=RESTORE"), "retired target-start restore orchestration must not survive");
assert(runtime.includes("$WorkspaceServices = @('control','metro-client','metro-partner','metro-captain','metro-field')"), "workspace-bound JavaScript services must have one canonical runtime set");
assert(runtime.includes("Assert-WorkspaceMounts"), "runtime readback must verify the repository bind mount for every workspace-bound service");
assert(runtime.includes("$WorkspaceVolumeDestinations"), "runtime readback must define canonical performance-sensitive workspace volume overlays");
assert(runtime.includes("WORKSPACE_VOLUME=FAIL"), "runtime readback must reject missing or non-volume node_modules overlays");
assert(runtime.includes("target=/workspace/apps/control-panel/.next"), "runtime readback must protect the Control Panel .next volume overlay");
assert(runtime.includes("DOCKER_WORKSPACE_MOUNTS=PASS source=repository-root target=/workspace overlays=volume"), "runtime doctor must expose workspace bind and volume-overlay proof");
assert(
  opener.includes("-Action Surface -Surface $surface"),
  "mobile opener must use the canonical read-only surface assertion",
);
assert(!opener.includes("docker compose") && !opener.includes("Compose @("), "mobile opener must not own Docker lifecycle");

const statusCase = section("function Show-Status", "function Doctor");
assert(statusCase.includes("Compose @('ps','-a')"), "runtime:status must use one lightweight Compose state display");
for (const forbidden of ["Get-CanonicalRuntimeSnapshot", "Assert-WorkspaceMounts", "Get-Native-Backend-Residue", "Assert-HostRuntimeEndpoints", "Test-Js-Dependencies-Ready"]) {
  assert(!statusCase.includes(forbidden), `runtime:status must remain display-only: ${forbidden}`);
}

const startupCase = section("function Start-Full-Runtime", "function Show-Status");
assert((startupCase.match(/Get-Native-Backend-Residue/g) ?? []).length === 1, "runtime:up must perform exactly one host-native backend census");
assert(!startupCase.includes("nativeBackendAfter"), "runtime:up must not repeat the host-native backend census after Compose");
assert(startupCase.includes("RUNTIME_RECONCILE=READY action=running-services-only"), "runtime:up must expose the exact-ready warm reconciliation path");
assert(startupCase.includes("--no-deps"), "warm reconciliation must not rerun completed one-shot dependencies");
assert(startupCase.includes("CANONICAL_LOCAL_RUNTIME=PASS mode=warm-reconcile"), "warm reconciliation must have an explicit success marker");
assert(startupCase.includes("RUNTIME_RECONCILE=RETRY mode=full"), "failed warm reconciliation must return to the canonical full repair path");
assert(startupCase.indexOf("Test-Full-RuntimeReady") < startupCase.indexOf("--no-deps"), "warm reconciliation must be gated by full runtime readiness");
assert(startupCase.indexOf("$dependenciesReady = Test-Js-Dependencies-Ready") < startupCase.indexOf("--no-deps"), "warm reconciliation must be gated by current dependency fingerprint readiness");


const doctorCase = section("function Doctor", "function Require-Service");
assert((doctorCase.match(/Get-Native-Backend-Residue/g) ?? []).length === 1, "runtime:doctor must perform exactly one host-native backend census");
assert(doctorCase.includes("Assert-HostRuntimeEndpoints"), "runtime:doctor must prove current host-published endpoints");
assert(runtime.includes("HOST_RUNTIME_ENDPOINTS=PASS"), "runtime doctor must expose host endpoint proof");

const controlCase = runtime.match(/'Control'\s*\{([\s\S]*?)\n\s*\}\n\s*'Surface'/)?.[1] ?? "";
const surfaceCase = runtime.match(/'Surface'\s*\{([\s\S]*?)\n\s*\}\n\s*'Rebuild'/)?.[1] ?? "";
assert(controlCase.includes("Read-CanonicalEnvironment") && controlCase.includes("Assert-Target-Runtime"), "control helper must read/validate the existing runtime");
assert(surfaceCase.includes("Read-CanonicalEnvironment") && surfaceCase.includes("Assert-Target-Runtime"), "surface helper must read/validate the existing runtime");
assert((controlCase.match(/Get-Native-Backend-Residue/g) ?? []).length === 1, "control helper must perform one host-native backend census");
assert((surfaceCase.match(/Get-Native-Backend-Residue/g) ?? []).length === 1, "surface helper must perform one host-native backend census");
assert(!controlCase.includes("Compose @(") && !surfaceCase.includes("Compose @("), "control/surface helpers must not mutate Compose lifecycle");
assert(runtime.includes("CONTROL_PANEL_READY=PASS mode=read-only"), "control helper must expose read-only semantics");
assert(runtime.includes("MOBILE_SURFACE_RUNTIME=PASS mode=read-only"), "surface helper must expose read-only semantics");

for (const forbidden of [
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

assert((compose.match(/interval: 30s/g) ?? []).length === 8, "canonical runtime healthchecks must use the quiet steady-state interval");
assert((compose.match(/start_interval: 2s/g) ?? []).length === 8, "canonical runtime healthchecks must retain fast startup probing");
assert(!compose.includes("interval: 5s"), "five-second steady-state healthcheck churn must not return");
for (const token of ["--max-size=1280", "--max-fps=30", "--video-bit-rate=4M", "--no-audio"]) {
  assert(scrcpy.includes(token), `scrcpy must retain the resource-bounded local-development option: ${token}`);
}

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
