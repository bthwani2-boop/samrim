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
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const absolute = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTextFiles(path.relative(repoRoot, absolute)));
    } else if (entry.isFile()) {
      out.push(path.relative(repoRoot, absolute).replaceAll("\\", "/"));
    }
  }
  return out;
}

const packageJson = JSON.parse(read("package.json"));
const scripts = packageJson.scripts ?? {};

const expectedDailyScripts = {
  "runtime:daily:up":
    "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Action Up",
  "runtime:daily:down":
    "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local-runtime.ps1 -Action Down",
};
for (const [name, command] of Object.entries(expectedDailyScripts)) {
  assert(
    scripts[name] === command,
    `${name} must route through the canonical DAILY_DEV runtime owner`,
  );
}

for (const forbidden of [
  "runtime:up",
  "runtime:down",
  "runtime:config",
  "runtime:integration:up",
  "runtime:integration:down",
  "runtime:integration:status",
  "runtime:integration:config",
  "runtime:integration:verify",
]) {
  assert(!(forbidden in scripts), `ambiguous/manual runtime command must not exist: ${forbidden}`);
}

assert(
  scripts["runtime:integration:close"] ===
    "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/integration-proof.ps1",
  "FULL_INTEGRATION must expose exactly one lifecycle-owning public proof entry point",
);

assert(
  typeof scripts["runtime:status"] === "string" &&
    scripts["runtime:status"].includes("--profile integration") &&
    scripts["runtime:status"].includes("ps -a"),
  "runtime:status must census integration-profile containers",
);

const envExample = read("infra/local/compose/.env.example");
const envMap = parseEnv(envExample, ".env.example");
const controlOrigin = envMap.get("CONTROL_PANEL_PUBLIC_ORIGIN");
const identityCors = envMap.get("IDENTITY_CORS_ALLOWED_ORIGINS");

assert(
  controlOrigin === "http://127.0.0.1:13000",
  "canonical DAILY_DEV Control Panel origin must be http://127.0.0.1:13000",
);
assert(
  identityCors === controlOrigin,
  "Identity CORS must equal the canonical DAILY_DEV Control Panel origin",
);

const forbiddenControlAlias = "http://localhost:" + "13000";

const forbiddenAliasFiles = [
  "package.json",
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  ...collectTextFiles("infra/local"),
  ...collectTextFiles("tools/dev"),
  ...collectTextFiles("apps/control-panel"),
  ...collectTextFiles(".github/workflows"),
];
for (const file of [...new Set(forbiddenAliasFiles)]) {
  if (!fs.existsSync(path.join(repoRoot, file))) continue;
  const body = read(file);
  assert(
    !body.includes(forbiddenControlAlias),
    `${file} reintroduces the forbidden Control Panel localhost alias`,
  );
}

const ensureLocalEnv = read("tools/dev/ensure-local-env.ps1");
assert(
  !/\[switch\]\s*\$Force\b/i.test(ensureLocalEnv),
  "ensure-local-env must not expose destructive Force-based secret regeneration",
);
assert(
  ensureLocalEnv.includes("infra\\local\\compose\\.env.example") ||
    ensureLocalEnv.includes("infra/local/compose/.env.example"),
  "ensure-local-env must derive local non-secret configuration from .env.example",
);
assert(
  ensureLocalEnv.includes("secrets=preserved"),
  "ensure-local-env must preserve existing local secrets during reconciliation",
);
assert(
  !ensureLocalEnv.includes("http://127.0.0.1:13000"),
  "ensure-local-env must not duplicate the canonical Control Panel origin literal",
);

const localRuntime = read("tools/dev/local-runtime.ps1");
assert(
  !localRuntime.includes('ValidateSet("Daily", "Integration")') &&
    !localRuntime.includes("FULL_INTEGRATION"),
  "local-runtime.ps1 must own DAILY_DEV only",
);
assert(
  localRuntime.includes("RUNTIME_MODE=DAILY_DEV"),
  "DAILY_DEV runtime mode marker is missing",
);
assert(
  localRuntime.includes('"identity",') &&
    localRuntime.includes('"dsh",') &&
    localRuntime.includes('"identity-migrate"'),
  "DAILY_DEV must remove Docker domain-service residue",
);

const integrationProof = read("tools/dev/integration-proof.ps1");
assert(
  integrationProof.includes("close-integration-runtime.ps1"),
  "integration proof wrapper must invoke the existing full proof core",
);
assert(
  integrationProof.includes("finally") &&
    integrationProof.includes("local-runtime.ps1") &&
    integrationProof.includes("-Action Down"),
  "integration proof must always tear down Docker runtime residue",
);
assert(
  !integrationProof.includes("-KeepRunning"),
  "public integration proof must not expose a keep-running escape hatch",
);

const compose = read("infra/local/compose/compose.yaml");
function serviceBlock(name) {
  const match = compose.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\n|^volumes:\\n)`, "m"),
  );
  if (!match) {
    failures.push(`Compose service missing: ${name}`);
    return "";
  }
  return match[0];
}
for (const name of ["identity-migrate", "identity", "dsh"]) {
  assert(
    serviceBlock(name).includes('profiles: ["integration"]'),
    `${name} must remain integration-profile only`,
  );
}
for (const name of ["identity", "dsh"]) {
  const block = serviceBlock(name);
  assert(block.includes('restart: "no"'), `${name} must not auto-resurrect with Docker Desktop`);
  assert(!block.includes("restart: unless-stopped"), `${name} retains an auto-restart policy`);
}
for (const name of ["postgres", "mailpit"]) {
  assert(!serviceBlock(name).includes("profiles:"), `${name} must remain DAILY_DEV infrastructure`);
}

const runGo = read("tools/dev/run-go-service.ps1");
assert(
  !runGo.includes("SERVICE_ALREADY_READY=PASS"),
  "Go host launcher still accepts unknown ready process provenance",
);
assert(
  runGo.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"),
  "Go host launcher lacks fail-closed ownership conflict",
);
assert(
  runGo.includes("Host runtime does not accept inherited PORT="),
  "Go host launcher still allows shadow PORT authority",
);

const control = read("tools/dev/start-control-panel.ps1");
assert(
  control.includes("ensure-local-env.ps1"),
  "Control Panel launcher must reconcile canonical local configuration before start",
);
assert(
  control.includes("CONTROL_PANEL_PUBLIC_ORIGIN") &&
    control.includes("IDENTITY_CORS_ALLOWED_ORIGINS"),
  "Control Panel launcher must validate origin/CORS coherence",
);
assert(
  !control.includes("$port = 13000") &&
    !control.includes("-H 127.0.0.1") &&
    !control.includes("http://127.0.0.1:13000"),
  "Control Panel launcher must derive host/port from canonical configuration rather than duplicate them",
);
assert(
  control.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"),
  "Control Panel launcher lacks fail-closed port ownership",
);

const controlPackage = JSON.parse(read("apps/control-panel/package.json"));
assert(
  !("start" in (controlPackage.scripts ?? {})),
  "Control Panel package must not expose a second hard-coded local start path",
);

const playwright = read("apps/control-panel/playwright.config.ts");
assert(
  playwright.includes('const DEFAULT_TEST_ORIGIN = "http://127.0.0.1:13001";'),
  "Playwright isolated runtime must have one explicit loopback test origin",
);
assert(
  !playwright.includes("localhost:13001"),
  "Playwright must not reintroduce localhost aliasing",
);
assert(
  playwright.includes("CONTROL_PANEL_PUBLIC_ORIGIN: parsedBase.origin"),
  "self-hosted Playwright must derive CSRF origin from its own test base URL",
);

const proxy = read("apps/control-panel/proxy.ts");
assert(
  /error:\s*\{\s*code:\s*"FORBIDDEN_CROSS_ORIGIN"/m.test(proxy),
  "cross-origin proxy failure must use the canonical nested error envelope",
);

const mobile = read("tools/mobile/start-mobile-runtime.ps1");
assert(
  !mobile.includes("METRO_ALREADY_READY=PASS"),
  "Mobile launcher still accepts unknown Metro provenance",
);
assert(
  mobile.includes("RUNTIME_OWNERSHIP_CONFLICT=FAIL"),
  "Mobile launcher lacks fail-closed Metro ownership conflict",
);

const candidate = read("tools/dev/verify-local-candidate.ps1");
assert(!candidate.includes("pnpm runtime:up"), "Local candidate proof still uses ambiguous runtime:up");
assert(!candidate.includes("pnpm runtime:down"), "Local candidate proof still uses ambiguous runtime:down");
assert(
  candidate.includes("pnpm runtime:daily:up"),
  "Local candidate proof does not exercise DAILY_DEV transition",
);
assert(
  candidate.includes("DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0"),
  "Local candidate proof does not census Docker domain-service absence",
);

const composeReadme = read("infra/local/compose/README.md");
assert(composeReadme.includes("DAILY_DEV"), "Local compose README lacks DAILY_DEV ownership");
assert(
  composeReadme.includes("runtime:integration:close"),
  "Local compose README must expose the single integration proof entry point",
);
assert(
  !composeReadme.includes("runtime:integration:up") &&
    !composeReadme.includes("runtime:integration:down"),
  "Local compose README must not advertise manual FULL_INTEGRATION lifecycle commands",
);

if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("LOCAL_RUNTIME_INTERACTIVE_MODE=DAILY_DEV_ONLY");
console.log("FULL_INTEGRATION_PUBLIC_ENTRYPOINTS=1");
console.log(`CONTROL_PANEL_DAILY_ORIGIN=${controlOrigin}`);
console.log("DAILY_DEV_DOCKER_DOMAIN_SERVICES=0");
console.log("FULL_INTEGRATION_RESIDUE_POLICY=ZERO");
console.log("RUNTIME_LAUNCHER_UNKNOWN_PROVENANCE_ACCEPTANCE=0");
console.log("RUNTIME_SHADOW_PORT_AUTHORITY=0");
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
