import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = JSON.parse(read("package.json"));
const scripts = packageJson.scripts ?? {};
const expectedScripts = {
  "runtime:daily:up":
    "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Mode Daily -Action Up",
  "runtime:daily:down":
    "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Mode Daily -Action Down",
  "runtime:integration:up":
    "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Mode Integration -Action Up",
  "runtime:integration:down":
    "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Mode Integration -Action Down",
};

for (const [name, command] of Object.entries(expectedScripts)) {
  assert(scripts[name] === command, name + " must route through the canonical local runtime transition owner");
}
for (const forbidden of ["runtime:up", "runtime:down", "runtime:config"]) {
  assert(!(forbidden in scripts), "ambiguous runtime mutation command must not exist: " + forbidden);
}
assert(
  typeof scripts["runtime:status"] === "string" &&
    scripts["runtime:status"].includes("--profile integration") &&
    scripts["runtime:status"].includes("ps -a"),
  "runtime:status must census integration-profile containers",
);

const compose = read("infra/local/compose/compose.yaml");
function serviceBlock(name) {
  const match = compose.match(new RegExp("^  " + name + ":\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\n|^volumes:\\n)", "m"));
  if (!match) {
    failures.push("Compose service missing: " + name);
    return "";
  }
  return match[0];
}
for (const name of ["identity-migrate", "identity", "dsh"]) {
  assert(serviceBlock(name).includes('profiles: ["integration"]'), name + " must be integration-profile only");
}
for (const name of ["identity", "dsh"]) {
  const block = serviceBlock(name);
  assert(block.includes('restart: "no"'), name + " must not auto-resurrect with Docker Desktop");
  assert(!block.includes("restart: unless-stopped"), name + " retains an auto-restart policy");
}
for (const name of ["postgres", "mailpit"]) {
  assert(!serviceBlock(name).includes("profiles:"), name + " must remain DAILY_DEV infrastructure");
}

const runtimeOwner = read("tools/dev/local-runtime.ps1");
assert(runtimeOwner.includes("RUNTIME_MODE=DAILY_DEV"), "Daily runtime mode marker is missing");
assert(runtimeOwner.includes("RUNTIME_MODE=FULL_INTEGRATION"), "Integration runtime mode marker is missing");
assert(
  runtimeOwner.includes('"rm", "-s", "-f", "identity", "dsh", "identity-migrate"'),
  "DAILY_DEV must remove integration domain-service residue before starting infrastructure",
);

const runGo = read("tools/dev/run-go-service.ps1");
assert(!runGo.includes("SERVICE_ALREADY_READY=PASS"), "Go host launcher still accepts unknown ready process provenance");
assert(runGo.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"), "Go host launcher lacks fail-closed ownership conflict");
assert(runGo.includes("Host runtime does not accept inherited PORT="), "Go host launcher still allows shadow PORT authority");

const control = read("tools/dev/start-control-panel.ps1");
assert(!control.includes("CONTROL_ALREADY_READY=PASS"), "Control launcher still accepts unknown ready process provenance");
assert(control.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"), "Control launcher lacks fail-closed ownership conflict");

const mobile = read("tools/mobile/start-mobile-runtime.ps1");
assert(!mobile.includes("METRO_ALREADY_READY=PASS"), "Mobile launcher still accepts unknown Metro provenance");
assert(mobile.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"), "Mobile launcher lacks fail-closed Metro ownership conflict");

const candidate = read("tools/dev/verify-local-candidate.ps1");
assert(!candidate.includes("pnpm runtime:up"), "Local candidate proof still uses ambiguous runtime:up");
assert(!candidate.includes("pnpm runtime:down"), "Local candidate proof still uses ambiguous runtime:down");
assert(candidate.includes("pnpm runtime:daily:up"), "Local candidate proof does not exercise DAILY_DEV transition");
assert(candidate.includes("DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0"), "Local candidate proof does not census Docker domain-service absence");

const composeReadme = read("infra/local/compose/README.md");
assert(!composeReadme.includes("MinIO"), "Local compose README claims a service that Compose does not define");
assert(composeReadme.includes("DAILY_DEV"), "Local compose README lacks DAILY_DEV ownership");
assert(composeReadme.includes("FULL_INTEGRATION"), "Local compose README lacks FULL_INTEGRATION ownership");

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("LOCAL_RUNTIME_MODES=EXPLICIT");
console.log("DAILY_DEV_DOCKER_DOMAIN_SERVICES=0");
console.log("FULL_INTEGRATION_HOST_DOMAIN_SERVICES_ALLOWED=0");
console.log("RUNTIME_LAUNCHER_UNKNOWN_PROVENANCE_ACCEPTANCE=0");
console.log("RUNTIME_SHADOW_PORT_AUTHORITY=0");
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
