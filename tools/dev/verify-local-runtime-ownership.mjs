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

function collectTextFiles(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const absolute = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) out.push(...collectTextFiles(path.relative(repoRoot, absolute)));
    else if (entry.isFile()) out.push(path.relative(repoRoot, absolute).replaceAll("\\", "/"));
  }
  return out;
}

const rootPackage = JSON.parse(read("package.json"));
const scripts = rootPackage.scripts ?? {};
const runtimeOwner = "tools/dev/runtime.ps1";
const pwshPrefix = `pwsh -NoProfile -ExecutionPolicy Bypass -File ${runtimeOwner} -Action `;
const expectedRootRuntimeScripts = new Map([
  ["runtime:daily:up", `${pwshPrefix}DailyUp`],
  ["runtime:daily:down", `${pwshPrefix}DailyDown`],
  ["runtime:status", `${pwshPrefix}Status`],
  ["runtime:integration:close", `${pwshPrefix}IntegrationClose`],
  ["identity", `${pwshPrefix}Identity`],
  ["dsh", `${pwshPrefix}Dsh`],
  ["control", `${pwshPrefix}Control`],
  ["client", `${pwshPrefix}Client`],
  ["partner", `${pwshPrefix}Partner`],
  ["captain", `${pwshPrefix}Captain`],
  ["field", `${pwshPrefix}Field`],
  ["scr", `${pwshPrefix}Scrcpy`],
]);

const allowedRuntimeScripts = new Set([
  "runtime:daily:up",
  "runtime:daily:down",
  "runtime:status",
  "runtime:verify-ownership",
  "runtime:integration:close",
]);
for (const name of Object.keys(scripts).filter((name) => name.startsWith("runtime:"))) {
  assert(allowedRuntimeScripts.has(name), `shadow/manual runtime command must not exist: ${name}`);
}
for (const [name, expected] of expectedRootRuntimeScripts) {
  assert(scripts[name] === expected, `${name} must route directly to ${runtimeOwner}`);
}
assert(
  scripts["runtime:verify-ownership"] === "node tools/dev/verify-local-runtime-ownership.mjs",
  "runtime:verify-ownership must remain the read-only repository ownership verifier",
);

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
]) {
  assert(!exists(retired), `retired runtime launcher must not exist: ${retired}`);
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

const envExample = read("infra/local/compose/.env.example");
const envMap = parseEnv(envExample, ".env.example");
const controlOrigin = envMap.get("CONTROL_PANEL_PUBLIC_ORIGIN");
const identityCors = envMap.get("IDENTITY_CORS_ALLOWED_ORIGINS");
let controlUri;
try { controlUri = new URL(controlOrigin); } catch { controlUri = null; }
assert(
  controlUri?.protocol === "http:" &&
  controlUri.hostname === "127.0.0.1" &&
  controlUri.port !== "" &&
  controlUri.pathname === "/",
  "canonical Control Panel origin drifted",
);
assert(identityCors === controlOrigin, "Identity CORS must equal the canonical Control Panel origin");
for (const key of [
  "SAMRIM_POSTGRES_PORT",
  "SAMRIM_MAILPIT_SMTP_PORT",
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

const verifierPath = "tools/dev/verify-local-runtime-ownership.mjs";
const materialRuntimeFiles = [...new Set([
  "package.json",
  "README.md",
  "CONTRIBUTING.md",
  ...collectTextFiles("infra/local"),
  ...collectTextFiles("tools/dev"),
  ...collectTextFiles("tools/mobile"),
  ...collectTextFiles("apps/control-panel"),
  ...collectTextFiles("services/identity"),
  ...collectTextFiles("services/dsh"),
  ...collectTextFiles(".github/workflows"),
])].filter((file) => exists(file) && file !== verifierPath);

const forbiddenControlAlias = controlUri ? `http://localhost:${controlUri.port}` : "http://localhost:";
for (const file of materialRuntimeFiles) {
  const body = read(file);
  assert(!body.includes(forbiddenControlAlias), `${file} reintroduces forbidden Control Panel localhost alias`);
}

const retiredRuntimeTokens = [
  ["tools/dev/local-" + "runtime.ps1", "retired DAILY_DEV launcher"],
  ["tools/dev/run-go-" + "service.ps1", "retired Go launcher"],
  ["tools/dev/start-control-" + "panel.ps1", "retired Control launcher"],
  ["tools/dev/integration-" + "proof.ps1", "retired Integration launcher"],
  ["tools/dev/runtime-" + "status.ps1", "retired status launcher"],
  ["tools/mobile/start-mobile-" + "runtime.ps1", "retired mobile launcher"],
  ["close-integration-" + "runtime.ps1", "retired integration lifecycle file"],
  ["install-powershell-" + "pnpm-router.ps1", "retired global PowerShell pnpm router"],
  ["BTHWANI PNPM " + "ROUTER", "retired global PowerShell pnpm router marker"],
  ["Keep" + "Running", "integration keep-running escape hatch"],
  ["runtime:integration:" + "up", "manual integration up command"],
  ["runtime:integration:" + "down", "manual integration down command"],
  ["runtime:integration:" + "status", "manual integration status command"],
  ["runtime:integration:" + "config", "manual integration config command"],
  ["runtime:integration:" + "verify", "manual integration verify command"],
  ["runtime:daily:" + "config", "shadow daily config command"],
  ["runtime:" + "logs", "shadow runtime logs command"],
];
for (const file of materialRuntimeFiles) {
  const body = read(file);
  for (const [token, label] of retiredRuntimeTokens) {
    assert(!body.includes(token), `${file} retains ${label}`);
  }
}

const ensureLocalEnv = read("tools/dev/ensure-local-env.ps1");
assert(!/\[switch\]\s*\$Force\b/i.test(ensureLocalEnv), "ensure-local-env must not expose Force regeneration");
assert(!ensureLocalEnv.includes("Preserved local-only values"), "unknown local configuration must not survive reconciliation");
assert(ensureLocalEnv.includes("unknown_removed="), "ensure-local-env must report removal of shadow keys");
assert(!ensureLocalEnv.includes("CONTROL_PANEL_PUBLIC_ORIGIN=http://"), "ensure-local-env must derive origin from .env.example");

const dailyCompose = read("infra/local/compose/compose.yaml");
const integrationCompose = read("infra/local/compose/compose.integration.yaml");
assert(/^name:\s*samrim-local\s*$/m.test(dailyCompose), "daily compose project must be samrim-local");
assert(/^name:\s*samrim-integration\s*$/m.test(integrationCompose), "integration compose project must be samrim-integration");
assert(!/^\s{2}(identity|identity-migrate|dsh):\s*$/m.test(dailyCompose), "daily compose must not contain domain services");
assert(!dailyCompose.includes("profiles:"), "daily compose must not contain alternate profiles");
for (const service of ["postgres", "mailpit", "identity-migrate", "identity", "dsh-migrate", "dsh"]) {
  assert(new RegExp(`^  ${service}:\\s*$`, "m").test(integrationCompose), `integration compose missing service: ${service}`);
}
assert(integrationCompose.includes("samrim-integration-postgres-data:/var/lib/postgresql/data"), "integration database must use isolated volume");
assert(!integrationCompose.includes("samrim-postgres-data:/var/lib/postgresql/data"), "integration compose must not mount DAILY_DEV database volume");
assert(!integrationCompose.includes("profiles:"), "integration compose must be a dedicated appliance");

const runtime = read(runtimeOwner);
for (const marker of [
  "RUNTIME_OWNER=tools/dev/runtime.ps1",
  "RUNTIME_MODE_TRANSITION=FULL_INTEGRATION_TO_DAILY_DEV",
  "RUNTIME_MODE_TRANSITION=DAILY_DEV_TO_FULL_INTEGRATION",
  "INTEGRATION_RUNTIME_RESIDUE=0",
  "DOCKER_OWNS=postgres,mailpit",
  "HOST_OWNS=identity,dsh,control-panel,mobile,scrcpy",
  "Reset-IntegrationIfPresent",
  "Set-CanonicalEnvironment",
  "SAMRIM_${appToken}_METRO_PORT",
  "exec', 'expo', 'start'",
  "go run ./cmd/api",
  "down', '--volumes', '--remove-orphans'",
  "verify-identity-runtime.mjs",
  "verify-dsh-runtime.mjs",
]) {
  assert(runtime.includes(marker), `canonical runtime owner missing invariant: ${marker}`);
}
for (const [key, value] of envMap) {
  if (/_PORT$/.test(key) && value) {
    assert(!runtime.includes(value), `canonical runtime owner hard-codes ${key}=${value} instead of deriving canonical env`);
  }
}
assert(!runtime.includes("--profile"), "canonical runtime owner must not use Docker Compose profiles");

const integrationVerifier = read("tools/dev/verify-integration-runtime.ps1");
assert(integrationVerifier.includes("compose.integration.yaml"), "integration verifier must use isolated integration compose");
assert(integrationVerifier.includes('"--project-name", "samrim-integration"'), "integration verifier must bind schema proof to samrim-integration");
assert(integrationVerifier.includes("EnvFile"), "integration verifier must consume the canonical environment path");
assert(!integrationVerifier.includes(":18082"), "integration verifier must not hard-code the Identity host port");
assert(!integrationVerifier.includes(":58080"), "integration verifier must not hard-code the DSH host port");

const identityRuntimeVerifier = read("tools/dev/verify-identity-runtime.mjs");
assert(identityRuntimeVerifier.includes("compose.integration.yaml"), "Identity runtime semantics must use isolated integration compose");
assert(identityRuntimeVerifier.includes('"--project-name", "samrim-integration"'), "Identity runtime semantics must bind Docker calls to samrim-integration");

const doctor = read("tools/dev/doctor.ps1");
for (const marker of [
  "local env key parity",
  "local non-secret value parity",
  "daily Docker service ownership",
  "integration container residue",
  "integration volume residue",
  "UNKNOWN_LOCAL_CONFIG_KEYS=0",
  "DAILY_INTEGRATION_STATE_SHARING=0",
]) {
  assert(doctor.includes(marker), `doctor missing invariant: ${marker}`);
}

const candidate = read("tools/dev/verify-local-candidate.ps1");
assert(candidate.includes("pnpm runtime:daily:up"), "candidate proof does not exercise DAILY_DEV");
assert(candidate.includes("pnpm runtime:integration:close"), "candidate proof does not exercise canonical integration proof");

const workflow = read(".github/workflows/baseline-guard.yml");
assert(workflow.includes("compose.integration.yaml"), "CI runtime proof must use isolated integration compose");

const composeReadme = read("infra/local/compose/README.md");
assert(composeReadme.includes(runtimeOwner), "compose README must name the single canonical runtime owner");
assert(composeReadme.includes("runtime:integration:close"), "compose README must expose one integration proof entrypoint");

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("CANONICAL_RUNTIME_FILES=1");
console.log("CANONICAL_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("INTERACTIVE_RUNTIME_MODES=1");
console.log("DAILY_DEV_APP_OWNER=HOST");
console.log("DAILY_DEV_INFRA_OWNER=DOCKER");
console.log(`CONTROL_PANEL_ORIGIN=${controlOrigin}`);
console.log("CONTROL_PANEL_ORIGIN_ALIASES=0");
console.log("UNKNOWN_LOCAL_CONFIG_KEYS=0");
console.log("PUBLIC_INTEGRATION_ENTRYPOINTS=1");
console.log("MANUAL_INTEGRATION_LIFECYCLE_COMMANDS=0");
console.log("INTEGRATION_KEEP_RUNNING_PATHS=0");
console.log("DAILY_INTEGRATION_STATE_SHARING=0");
console.log("INTEGRATION_RUNTIME_RESIDUE_POLICY=ZERO");
console.log("DOCKER_DOMAIN_SERVICES_DURING_DAILY=0");
console.log("SECONDARY_NX_RUNTIME_TARGETS=0");
console.log("MOBILE_SHADOW_RUNTIME_ENTRYPOINTS=0");
console.log("GLOBAL_PNPM_ROUTER_PATHS=0");
console.log("SHADOW_RUNTIME_COMMANDS=0");
console.log("SHADOW_CONFIG_AUTHORITY=0");
console.log("KNOWN_RUNTIME_DRIFT_PATHS=0");
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
