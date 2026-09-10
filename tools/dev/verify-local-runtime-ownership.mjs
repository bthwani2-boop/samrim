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

const packageJson = JSON.parse(read("package.json"));
const scripts = packageJson.scripts ?? {};
const allowedRuntimeScripts = new Set([
  "runtime:daily:up",
  "runtime:daily:down",
  "runtime:status",
  "runtime:verify-ownership",
  "runtime:integration:close",
]);

for (const name of Object.keys(scripts).filter((name) => name.startsWith("runtime:"))) {
  assert(allowedRuntimeScripts.has(name), `shadow/manual runtime command must not exist: ${name}`);
  assert(!String(scripts[name]).includes("docker compose"), `root runtime script must not call docker compose directly: ${name}`);
}

assert(
  scripts["runtime:daily:up"] === "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Action Up",
  "runtime:daily:up must route through local-runtime.ps1",
);
assert(
  scripts["runtime:daily:down"] === "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Action Down",
  "runtime:daily:down must route through local-runtime.ps1",
);
assert(
  scripts["runtime:status"] === "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/runtime-status.ps1",
  "runtime:status must be a read-only repository-owned census",
);
assert(
  scripts["runtime:integration:close"] === "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/integration-proof.ps1",
  "FULL_INTEGRATION must expose exactly one public lifecycle-owning proof entrypoint",
);

assert(!exists("tools/dev/close-integration-runtime.ps1"), "retired close-integration-runtime.ps1 must not exist");

const envExample = read("infra/local/compose/.env.example");
const envMap = parseEnv(envExample, ".env.example");
const controlOrigin = envMap.get("CONTROL_PANEL_PUBLIC_ORIGIN");
const identityCors = envMap.get("IDENTITY_CORS_ALLOWED_ORIGINS");
assert(controlOrigin === "http://127.0.0.1:13000", "canonical Control Panel origin drifted");
assert(identityCors === controlOrigin, "Identity CORS must equal the canonical Control Panel origin");

const materialRuntimeFiles = [...new Set([
  "package.json",
  "README.md",
  "CONTRIBUTING.md",
  ...collectTextFiles("infra/local"),
  ...collectTextFiles("tools/dev"),
  ...collectTextFiles("apps/control-panel"),
  ...collectTextFiles(".github/workflows"),
])].filter((file) => exists(file));

const forbiddenControlAlias = "http://localhost:" + "13000";
for (const file of materialRuntimeFiles) {
  assert(!read(file).includes(forbiddenControlAlias), `${file} reintroduces forbidden Control Panel localhost alias`);
}

const retiredRuntimeTokens = [
  ["--profile " + "integration", "retired integration profile"],
  ["close-integration-" + "runtime.ps1", "retired integration lifecycle file"],
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
assert(!ensureLocalEnv.includes("http://127.0.0.1:13000"), "ensure-local-env must derive origin from .env.example");

const dailyCompose = read("infra/local/compose/compose.yaml");
const integrationCompose = read("infra/local/compose/compose.integration.yaml");
assert(/^name:\s*samrim-local\s*$/m.test(dailyCompose), "daily compose project must be samrim-local");
assert(/^name:\s*samrim-integration\s*$/m.test(integrationCompose), "integration compose project must be samrim-integration");
assert(!/^\s{2}(identity|identity-migrate|dsh):\s*$/m.test(dailyCompose), "daily compose must not contain domain services");
assert(!dailyCompose.includes("profiles:"), "daily compose must not contain alternate profiles");
for (const service of ["postgres", "mailpit", "identity-migrate", "identity", "dsh"]) {
  assert(new RegExp(`^  ${service}:\\s*$`, "m").test(integrationCompose), `integration compose missing service: ${service}`);
}
assert(integrationCompose.includes("samrim-integration-postgres-data:/var/lib/postgresql/data"), "integration database must use isolated volume");
assert(!integrationCompose.includes("samrim-postgres-data:/var/lib/postgresql/data"), "integration compose must not mount DAILY_DEV database volume");
assert(!integrationCompose.includes("profiles:"), "integration compose must be a dedicated appliance, not a profile of DAILY_DEV");

const localRuntime = read("tools/dev/local-runtime.ps1");
assert(localRuntime.includes("RUNTIME_MODE=DAILY_DEV"), "DAILY_DEV mode marker missing");
assert(localRuntime.includes("samrim-integration"), "DAILY_DEV must reject integration residue");
assert(localRuntime.includes("--remove-orphans"), "DAILY_DEV must clean legacy same-project orphan containers");
assert(!localRuntime.includes("--profile"), "DAILY_DEV runtime must not know an integration profile");
assert(!localRuntime.includes("identity-migrate"), "DAILY_DEV runtime must not manage integration domain services");

const integrationProof = read("tools/dev/integration-proof.ps1");
assert(integrationProof.includes("compose.integration.yaml"), "integration proof must use isolated compose file");
assert(integrationProof.includes("samrim-integration"), "integration proof must own isolated project identity");
assert(integrationProof.includes("finally"), "integration proof must have unconditional teardown");
assert(integrationProof.includes('"down", "--volumes", "--remove-orphans"'), "integration proof teardown must destroy isolated state");
assert(integrationProof.includes("DAILY_INTEGRATION_STATE_SHARING=0"), "integration proof must assert state isolation");
assert(!integrationProof.includes("local-runtime.ps1"), "integration proof must not mutate DAILY_DEV lifecycle");

const integrationVerifier = read("tools/dev/verify-integration-runtime.ps1");
assert(integrationVerifier.includes("compose.integration.yaml"), "integration verifier must use isolated integration compose");
assert(integrationVerifier.includes('"--project-name", "samrim-integration"'), "integration verifier must bind schema proof to samrim-integration");
assert(!integrationVerifier.includes('"infra/local/compose/compose.yaml"'), "integration verifier must not call the DAILY_DEV compose file");

const runtimeStatus = read("tools/dev/runtime-status.ps1");
assert(!runtimeStatus.includes(" compose "), "runtime-status must remain a read-only Docker label census");
assert(runtimeStatus.includes("INTEGRATION_CONTAINERS="), "runtime-status must report integration residue");

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

const runGo = read("tools/dev/run-go-service.ps1");
assert(!runGo.includes("SERVICE_ALREADY_READY=PASS"), "Go launcher still accepts unknown ready process provenance");
assert(runGo.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"), "Go launcher lacks fail-closed ownership conflict");
assert(runGo.includes("Host runtime does not accept inherited PORT="), "Go launcher allows shadow PORT authority");

const control = read("tools/dev/start-control-panel.ps1");
assert(control.includes("ensure-local-env.ps1"), "Control Panel launcher must reconcile canonical env");
assert(control.includes("CONTROL_PANEL_PUBLIC_ORIGIN") && control.includes("IDENTITY_CORS_ALLOWED_ORIGINS"), "Control Panel launcher must validate origin/CORS coherence");
assert(control.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"), "Control Panel launcher lacks fail-closed ownership");
assert(!control.includes("http://127.0.0.1:13000"), "Control Panel launcher must derive its origin rather than duplicate it");

const controlPackage = JSON.parse(read("apps/control-panel/package.json"));
assert(!("start" in (controlPackage.scripts ?? {})), "Control Panel package must not expose a second local start path");

const playwright = read("apps/control-panel/playwright.config.ts");
assert(playwright.includes('const DEFAULT_TEST_ORIGIN = "http://127.0.0.1:13001";'), "Playwright isolated test origin drifted");
assert(!playwright.includes("localhost:13001"), "Playwright reintroduced localhost aliasing");
assert(playwright.includes("CONTROL_PANEL_PUBLIC_ORIGIN: parsedBase.origin"), "Playwright must derive CSRF origin from its test base URL");

const proxy = read("apps/control-panel/proxy.ts");
assert(/error:\s*\{\s*code:\s*"FORBIDDEN_CROSS_ORIGIN"/m.test(proxy), "cross-origin failure envelope is not canonical");

const mobile = read("tools/mobile/start-mobile-runtime.ps1");
assert(!mobile.includes("METRO_ALREADY_READY=PASS"), "Mobile launcher accepts unknown Metro provenance");
assert(mobile.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"), "Mobile launcher lacks fail-closed Metro ownership");

const candidate = read("tools/dev/verify-local-candidate.ps1");
assert(candidate.includes("pnpm runtime:daily:up"), "candidate proof does not exercise DAILY_DEV");
assert(candidate.includes("pnpm runtime:integration:close"), "candidate proof must use the single public integration entrypoint");

const workflow = read(".github/workflows/baseline-guard.yml");
assert(workflow.includes("compose.integration.yaml"), "CI runtime proof must use isolated integration compose");

const composeReadme = read("infra/local/compose/README.md");
assert(composeReadme.includes("compose.integration.yaml"), "compose README must describe isolated integration appliance");
assert(composeReadme.includes("runtime:integration:close"), "compose README must expose one integration proof entrypoint");

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

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
console.log("SHADOW_RUNTIME_COMMANDS=0");
console.log("SHADOW_CONFIG_AUTHORITY=0");
console.log("KNOWN_RUNTIME_DRIFT_PATHS=0");
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
