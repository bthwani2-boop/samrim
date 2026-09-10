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
    if (separator < 1) {
      failures.push(`${label} contains malformed environment line: ${rawLine}`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (map.has(key)) failures.push(`${label} contains duplicate key: ${key}`);
    map.set(key, value);
  }
  return map;
}

const rootPackage = JSON.parse(read("package.json"));
const scripts = rootPackage.scripts ?? {};
const runtimeOwner = "tools/dev/runtime.ps1";
const pwshPrefix = `pwsh -NoProfile -ExecutionPolicy Bypass -File ${runtimeOwner} -Action `;

const expectedRuntimeScripts = new Map([
  ["runtime:up", `${pwshPrefix}Up`],
  ["runtime:down", `${pwshPrefix}Down`],
  ["runtime:restart", `${pwshPrefix}Restart`],
  ["runtime:status", `${pwshPrefix}Status`],
  ["runtime:logs", `${pwshPrefix}Logs`],
  ["runtime:doctor", `${pwshPrefix}Doctor`],
  ["runtime:reset", `${pwshPrefix}Reset`],
]);
for (const [name, expected] of expectedRuntimeScripts) {
  assert(scripts[name] === expected, `${name} must route directly to ${runtimeOwner}`);
}
assert(
  scripts["runtime:verify-ownership"] === "node tools/dev/verify-local-runtime-ownership.mjs",
  "runtime:verify-ownership must remain the read-only repository ownership verifier",
);
const allowedRuntimeScripts = new Set([...expectedRuntimeScripts.keys(), "runtime:verify-ownership"]);
for (const name of Object.keys(scripts).filter((name) => name.startsWith("runtime:"))) {
  assert(allowedRuntimeScripts.has(name), `shadow/manual runtime command must not exist: ${name}`);
}
for (const forbidden of ["identity", "dsh", "doctor"]) {
  assert(scripts[forbidden] === undefined, `retired public runtime command must not exist: ${forbidden}`);
}

for (const [name, action] of [
  ["control", "Control"],
  ["client", "Client"],
  ["partner", "Partner"],
  ["captain", "Captain"],
  ["field", "Field"],
  ["scr", "Scrcpy"],
]) {
  assert(scripts[name] === `${pwshPrefix}${action}`, `${name} must route directly to ${runtimeOwner}`);
}

assert(exists(runtimeOwner), `canonical runtime owner is missing: ${runtimeOwner}`);
for (const retired of [
  "tools/dev/local-runtime.ps1",
  "tools/dev/run-go-service.ps1",
  "tools/dev/start-control-panel.ps1",
  "tools/dev/integration-proof.ps1",
  "tools/dev/runtime-status.ps1",
  "tools/mobile/start-mobile-runtime.ps1",
  "tools/dev/close-integration-runtime.ps1",
  "tools/dev/install-powershell-pnpm-router.ps1",
  "tools/dev/verify-integration-runtime.ps1",
  "tools/dev/doctor.ps1",
  "tools/dev/ensure-local-env.ps1",
]) {
  assert(!exists(retired), `retired runtime file must not exist: ${retired}`);
}

const composeDir = path.join(repoRoot, "infra/local/compose");
const composeFiles = fs.readdirSync(composeDir).filter((name) => /^compose(?:\..+)?\.ya?ml$/i.test(name));
assert(composeFiles.length === 1 && composeFiles[0] === "compose.yaml", `exactly one local Compose file is required; found: ${composeFiles.join(",")}`);
assert(!exists("infra/local/compose/compose.integration.yaml"), "parallel integration Compose file must not exist");

const compose = read("infra/local/compose/compose.yaml");
assert(/^name:\s*samrim-local\s*$/m.test(compose), "canonical Compose project must be samrim-local");
for (const service of ["postgres", "mailpit", "identity-migrate", "identity", "dsh-migrate", "dsh"]) {
  assert(new RegExp(`^  ${service}:\\s*$`, "m").test(compose), `canonical Compose missing service: ${service}`);
}
assert(!compose.includes("profiles:"), "canonical Compose must not expose alternate profiles");
assert(compose.includes("@postgres:5432/"), "Docker services must use internal PostgreSQL DNS");
assert(compose.includes('DSH_IDENTITY_API_BASE_URL: "http://identity:8082"'), "DSH must use internal Identity Docker DNS");
assert(compose.includes('IDENTITY_MAILPIT_SMTP_ADDR: "mailpit:1025"'), "Identity must use internal Mailpit SMTP DNS");
assert(!/127\.0\.0\.1:\$\{SAMRIM_POSTGRES_PORT/.test(compose), "PostgreSQL must not publish a host port");
assert(!/127\.0\.0\.1:\$\{SAMRIM_MAILPIT_SMTP_PORT/.test(compose), "Mailpit SMTP must not publish a host port");

const envMap = parseEnv(read("infra/local/compose/.env.example"), ".env.example");
for (const key of ["SAMRIM_POSTGRES_PORT", "SAMRIM_MAILPIT_SMTP_PORT", "SAMRIM_IDENTITY_BIND_HOST"]) {
  assert(!envMap.has(key), `obsolete host-only runtime key must not exist: ${key}`);
}
for (const key of [
  "SAMRIM_MAILPIT_WEB_PORT",
  "SAMRIM_IDENTITY_PORT",
  "SAMRIM_DSH_PORT",
  "SAMRIM_APP_CLIENT_METRO_PORT",
  "SAMRIM_APP_PARTNER_METRO_PORT",
  "SAMRIM_APP_CAPTAIN_METRO_PORT",
  "SAMRIM_APP_FIELD_METRO_PORT",
]) {
  const value = Number(envMap.get(key));
  assert(Number.isInteger(value) && value >= 1 && value <= 65535, `invalid canonical runtime port ${key}`);
}
const controlOrigin = envMap.get("CONTROL_PANEL_PUBLIC_ORIGIN");
assert(envMap.get("IDENTITY_CORS_ALLOWED_ORIGINS") === controlOrigin, "Identity CORS must equal the canonical Control Panel origin");

const runtime = read(runtimeOwner);
for (const marker of [
  "$CanonicalProject = 'samrim-local'",
  "$EnvExamplePath = Join-Path $ComposeDir '.env.example'",
  "function Ensure-Environment",
  "function New-RandomHex",
  "Assert-NoParallelRuntimeResidue",
  "Get-NonCanonicalSamrimProjects",
  "DOCKER_OWNS=postgres,mailpit,identity,dsh",
  "CANONICAL_LOCAL_RUNTIME=PASS",
  "RUNTIME_RESET=PASS",
  "Assert-CanonicalPublishedPort",
]) {
  assert(runtime.includes(marker), `canonical runtime owner missing invariant: ${marker}`);
}
assert(!runtime.includes("ensure-local-env.ps1"), "canonical runtime owner must not delegate environment reconciliation to a second executable");
assert(/['"]exec['"]\s*,\s*['"]expo['"]\s*,\s*['"]start['"]/.test(runtime), "canonical runtime owner must launch Expo through pnpm exec expo start");
const nativeApiToken = "go run ./cmd/" + "api";
const nativeMigrationToken = "go run ./cmd/" + "migrate";
assert(!runtime.includes(nativeApiToken), "canonical runtime owner must not launch Identity/DSH natively");
assert(!runtime.includes(nativeMigrationToken), "canonical runtime owner must not run backend migrations natively");
const retiredProject = "samrim-" + "integration";
assert(!runtime.includes(retiredProject), "canonical runtime owner must not retain a hard-coded retired parallel project name");
for (const oldToken of [
  "Daily" + "Up",
  "Daily" + "Down",
  "Integration" + "Close",
  "Ensure-" + "DailyRuntime",
  "Reset-" + "IntegrationRuntime",
  "Start-Go" + "Service",
]) {
  assert(!runtime.includes(oldToken), `canonical runtime owner retains retired mode/launcher token: ${oldToken}`);
}

const noRuntimeTargets = new Map([
  ["services/identity/project.json", ["serve", "dev", "start", "up", "down", "config"]],
  ["services/dsh/project.json", ["serve", "dev", "start", "up", "down", "config"]],
  ["apps/control-panel/project.json", ["serve", "dev", "start", "up", "down", "config"]],
  ["apps/app-client/project.json", ["serve", "dev", "start", "up", "down", "config"]],
  ["apps/app-partner/project.json", ["serve", "dev", "start", "up", "down", "config"]],
  ["apps/app-captain/project.json", ["serve", "dev", "start", "up", "down", "config"]],
  ["apps/app-field/project.json", ["serve", "dev", "start", "up", "down", "config"]],
  ["infra/project.json", ["serve", "dev", "start", "up", "down", "config"]],
]);
for (const [file, forbiddenTargets] of noRuntimeTargets) {
  const project = JSON.parse(read(file));
  for (const target of forbiddenTargets) {
    assert(project.targets?.[target] === undefined, `${file} exposes shadow runtime target '${target}'`);
  }
}

const controlPackage = JSON.parse(read("apps/control-panel/package.json"));
for (const script of ["dev", "serve", "start"]) {
  assert(controlPackage.scripts?.[script] === undefined, `Control Panel package exposes shadow runtime script '${script}'`);
}
for (const app of ["app-client", "app-partner", "app-captain", "app-field"]) {
  const pkg = JSON.parse(read(`apps/${app}/package.json`));
  assert(pkg.scripts?.start === undefined, `${app} package exposes shadow runtime script 'start'`);
}

for (const verifier of [
  "tools/dev/verify-identity-runtime.mjs",
  "tools/dev/verify-dsh-runtime.mjs",
]) {
  const body = read(verifier);
  assert(body.includes("compose.yaml"), `${verifier} must use the canonical Compose file`);
  assert(body.includes("samrim-local"), `${verifier} must use the canonical Compose project`);
  assert(!body.includes("compose.integration.yaml"), `${verifier} retains parallel Compose path`);
  assert(!body.includes(retiredProject), `${verifier} retains parallel Compose project`);
}

const candidate = read("tools/dev/verify-local-candidate.ps1");
for (const command of ["pnpm runtime:up", "pnpm runtime:doctor", "pnpm runtime:down"]) {
  assert(candidate.includes(command), `candidate proof must exercise ${command}`);
}
assert(candidate.includes("Invoke-CanonicalSchemaVerify"), "candidate proof must retain exact schema verification without a separate integration-runtime wrapper");
assert(!candidate.includes("verify-integration-runtime.ps1"), "candidate proof retains deleted integration-runtime wrapper");
assert(!candidate.includes("doctor.ps1"), "candidate proof retains deleted duplicate doctor wrapper");
assert(!candidate.includes("ensure-local-env.ps1"), "candidate proof retains deleted environment wrapper");
assert(!candidate.includes("runtime:daily:"), "candidate proof retains DAILY_DEV runtime command");
assert(!candidate.includes("runtime:integration:"), "candidate proof retains parallel Integration runtime command");

const playwright = read("apps/control-panel/playwright.config.ts");
assert(!/\bwebServer\s*:/.test(playwright), "Playwright must not create an implicit second local Control Panel server");
assert(!playwright.includes("http://127.0.0.1:13001"), "Playwright config retains alternate local Control Panel origin");

const workflow = read(".github/workflows/baseline-guard.yml");
assert(workflow.includes("infra/local/compose/compose.yaml"), "CI must use the canonical Compose topology");
assert(!workflow.includes("compose.integration.yaml"), "CI retains parallel Compose topology");
assert(!workflow.includes(retiredProject), "CI retains parallel Compose project");
assert(!workflow.includes("tools/dev/doctor.ps1"), "CI retains deleted duplicate doctor wrapper");
assert(!workflow.includes("verify-integration-runtime.ps1"), "CI retains deleted integration-runtime wrapper");
assert(!workflow.includes("ensure-local-env.ps1"), "CI retains deleted environment wrapper");

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("CANONICAL_LOCAL_COMPOSE_FILES=1");
console.log("CANONICAL_LOCAL_COMPOSE_PROJECTS=1");
console.log("PUBLIC_RUNTIME_EXECUTORS=1");
console.log("CANONICAL_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("IDENTITY_OWNER=DOCKER");
console.log("DSH_OWNER=DOCKER");
console.log("CONTROL_PANEL_OWNER=HOST_RUNTIME_PS1");
console.log("MOBILE_OWNER=HOST_RUNTIME_PS1");
console.log("PARALLEL_LOCAL_RUNTIME_AUTHORITY=0");
console.log("NATIVE_BACKEND_START_PATHS=0");
console.log("PORT_FALLBACK_PATHS=0");
console.log(`CONTROL_PANEL_ORIGIN=${controlOrigin}`);
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
