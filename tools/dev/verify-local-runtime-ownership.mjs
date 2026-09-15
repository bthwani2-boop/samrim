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
assert(!compose.includes("profiles:"), "parallel Compose profiles are forbidden");
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

assert(!runtime.includes("Stop-OtherOptionalServices"), "target startup must not stop unrelated running surfaces");
assert(
  runtime.includes("Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans',$Target)"),
  "target startup must use Compose dependency resolution without rebuilding the whole stack",
);
assert(
  opener.includes("-Action Surface -Surface $surface"),
  "mobile opener must delegate target runtime ownership to runtime.ps1",
);

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
