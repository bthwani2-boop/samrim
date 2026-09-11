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
const deviceToolOwner = "tools/dev/scrcpy.ps1";
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
]) {
  assert(scripts[name] === `${pwshPrefix}${action}`, `${name} must route directly to ${runtimeOwner}`);
}

assert(exists(runtimeOwner), `canonical runtime owner is missing: ${runtimeOwner}`);
assert(
  scripts.scr === `pwsh -NoProfile -ExecutionPolicy Bypass -File ${deviceToolOwner}`,
  `scr must route directly to ${deviceToolOwner}`,
);
assert(exists(deviceToolOwner), `canonical device tool owner is missing: ${deviceToolOwner}`);
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
assert(exists("infra/local/docker/js-runtime.Dockerfile"), "canonical JS runtime Dockerfile is missing");
assert(!exists("infra/local/docker/js-dev.Dockerfile"), "retired JS workspace-build Dockerfile must not survive");
assert(exists("tools/dev/js-deps.mjs"), "canonical JS dependency synchronizer is missing");
assert(exists(".dockerignore"), "repository Docker build context guard is missing");
const pnpmWorkspace = read("pnpm-workspace.yaml");
const jsRuntimeDockerfile = read("infra/local/docker/js-runtime.Dockerfile");
const jsDeps = read("tools/dev/js-deps.mjs");
assert(/^nodeLinker:\s*isolated\s*$/m.test(pnpmWorkspace), "canonical workspace must retain isolated pnpm linking");
assert(!jsRuntimeDockerfile.includes("COPY . ."), "JS runtime image must not copy repository source");
assert(!/pnpm\s+install/.test(jsRuntimeDockerfile), "JS runtime image must not install workspace dependencies");
assert(jsRuntimeDockerfile.includes("pnpm@10.34.0"), "JS runtime image must pin canonical pnpm");
assert(jsDeps.includes("--frozen-lockfile"), "JS dependency synchronizer must use frozen lockfile installation");
assert(jsDeps.includes(".samrim-js-deps-fingerprint"), "JS dependency synchronizer must persist a dependency fingerprint");
assert(jsDeps.includes('CI: "true"'), "JS dependency synchronizer must explicitly run pnpm in non-interactive CI mode");

const compose = read("infra/local/compose/compose.yaml");
assert(compose.includes("  js-deps:"), "canonical Compose must own one JS dependency one-shot service");
assert(compose.includes("image: samrim-local-js-runtime:dev"), "Control/Metro must share one canonical JS runtime image");
assert(compose.includes("samrim-js-pnpm-store:/pnpm/store"), "JS dependency preparation must retain a Docker-owned pnpm store");
assert(/^name:\s*samrim-local\s*$/m.test(compose), "canonical Compose project must be samrim-local");
for (const service of ["postgres", "mailpit", "identity-migrate", "identity", "dsh-migrate", "dsh", "js-deps", "control", "metro-client", "metro-partner", "metro-captain", "metro-field"]) {
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
  "SAMRIM_CONTROL_PORT",
  "SAMRIM_APP_CLIENT_METRO_PORT",
  "SAMRIM_APP_PARTNER_METRO_PORT",
  "SAMRIM_APP_CAPTAIN_METRO_PORT",
  "SAMRIM_APP_FIELD_METRO_PORT",
]) {
  const value = Number(envMap.get(key));
  assert(Number.isInteger(value) && value >= 1 && value <= 65535, `invalid canonical runtime port ${key}`);
}
const identityApiUrl = envMap.get("IDENTITY_API_BASE_URL");
const dshApiUrl = envMap.get("DSH_API_BASE_URL");
const controlOrigin = envMap.get("CONTROL_PANEL_PUBLIC_ORIGIN");
assert(envMap.get("IDENTITY_CORS_ALLOWED_ORIGINS") === controlOrigin, "Identity CORS must equal the canonical Control Panel origin");
assert(envMap.get("EXPO_PUBLIC_IDENTITY_API_URL") === identityApiUrl, "mobile Identity URL must project the canonical Identity API URL");
assert(envMap.get("EXPO_PUBLIC_DSH_API_URL") === dshApiUrl, "mobile DSH URL must project the canonical DSH API URL");

const runtime = read(runtimeOwner);
for (const marker of [
  "$CanonicalProject = 'samrim-local'",
  "$EnvExamplePath = Join-Path $ComposeDir '.env.example'",
  "function Ensure-Environment",
  "function New-RandomHex",
  "Assert-NoParallelRuntimeResidue",
  "Get-NonCanonicalSamrimProjects",
  "DOCKER_OWNS=postgres,mailpit,identity,dsh,control,metro-client,metro-partner,metro-captain,metro-field",
  "CANONICAL_LOCAL_RUNTIME=PASS",
  "RUNTIME_RESET=PASS",
  "Assert-CanonicalPublishedPort",
]) {
  assert(runtime.includes(marker), `canonical runtime owner missing invariant: ${marker}`);
}
assert(!runtime.includes("ensure-local-env.ps1"), "canonical runtime owner must not delegate environment reconciliation to a second executable");
assert(
  !/['"]exec['"]\s*,\s*['"]expo['"]\s*,\s*['"]start['"]/.test(runtime),
  "canonical runtime owner must not launch Expo/Metro as a host process after Docker cutover",
);
assert(
  !/next\s+dev/.test(runtime),
  "canonical runtime owner must not launch Next.js as a host process after Docker cutover",
);
assert(runtime.includes("Ensure-MobileLanInfrastructure"), "mobile runtime must own Wi-Fi LAN infrastructure");
assert(runtime.includes("MOBILE_TRANSPORT=WIFI_LAN"), "mobile runtime must identify Wi-Fi LAN transport");
assert(runtime.includes("ADB_REVERSE_DEPENDENCY=0"), "mobile runtime must assert zero adb reverse dependency");
assert(runtime.includes("MOBILE_OWNER=DOCKER"), "mobile runtime must report Docker ownership");
assert(runtime.includes("CONTROL_PANEL_OWNER=DOCKER"), "Control Panel runtime must report Docker ownership");
assert(runtime.includes("function Get-HttpText"), "canonical runtime must own one byte-safe HTTP text boundary");
assert(!runtime.includes(".Content.Trim()"), "canonical runtime must not call Trim directly on an untyped HTTP response body");
assert(runtime.includes("Assert-OneShotSucceeded -Service 'js-deps'"), "canonical runtime must prove JS dependency preparation");
assert(
  runtime.includes("function Remove-MobileLanInfrastructure"),
  "canonical runtime must retain explicit mobile LAN cleanup for destructive reset",
);

const wifiLanStopStart =
  runtime.indexOf("function Stop-CanonicalRuntime");
const wifiLanStopEnd =
  runtime.indexOf("function Show-RuntimeStatus");

assert(
  wifiLanStopStart >= 0 &&
    wifiLanStopEnd > wifiLanStopStart &&
    !runtime
      .slice(wifiLanStopStart, wifiLanStopEnd)
      .includes("Remove-MobileLanInfrastructure"),
  "mobile LAN infrastructure must survive ordinary runtime down",
);
assert(
  runtime
    .slice(wifiLanStopStart, wifiLanStopEnd)
    .includes("MOBILE_LAN_INFRA=PRESERVED"),
  "runtime down must explicitly report preserved mobile LAN infrastructure",
);

const wifiLanResetStart =
  runtime.indexOf("function Reset-CanonicalRuntime");
const wifiLanResetEnd =
  runtime.indexOf("function Start-ControlPanel");

assert(
  wifiLanResetStart >= 0 &&
    wifiLanResetEnd > wifiLanResetStart &&
    runtime
      .slice(wifiLanResetStart, wifiLanResetEnd)
      .includes("Remove-MobileLanInfrastructure"),
  "mobile LAN infrastructure must be cleaned by runtime reset",
);
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

  const identityBinding = read(`apps/${app}/src/identity.ts`);
  assert(identityBinding.includes("EXPO_PUBLIC_IDENTITY_API_URL"), `${app} must consume the canonical public Identity URL`);
  assert(!identityBinding.includes("getExpoHostUri"), `${app} retains Expo-host Identity fallback`);
  assert(!identityBinding.includes("Constants.expoConfig"), `${app} retains Expo-host Identity fallback`);
}

const mobileIdentity = read("services/identity/clients/mobile.ts");
assert(!mobileIdentity.includes("defaultDevPort"), "mobile Identity runtime retains default port fallback");
assert(!mobileIdentity.includes("getExpoHostUri"), "mobile Identity runtime retains Expo-host fallback");
assert(!mobileIdentity.includes("18082"), "mobile Identity runtime hard-codes a local backend port");
assert(mobileIdentity.includes("IDENTITY_BASE_URL_REQUIRED"), "mobile Identity runtime must fail closed when explicit API URL is absent");

const partnerProduct = read("apps/app-partner/src/partner-product.ts");
assert(partnerProduct.includes("EXPO_PUBLIC_DSH_API_URL"), "Partner DSH binding must consume the canonical public DSH URL");
assert(!partnerProduct.includes("Constants.expoConfig"), "Partner DSH binding retains Expo-host fallback");
assert(!partnerProduct.includes("58080"), "Partner DSH binding hard-codes a local backend port");

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
assert(!playwright.includes('|| "http://127.0.0.1:13000"'), "Playwright retains a hard-coded canonical-port fallback");
assert(playwright.includes("PLAYWRIGHT_BASE_URL or CONTROL_PANEL_PUBLIC_ORIGIN is required"), "Playwright must fail closed when canonical origin is not supplied");

const baselineWorkflow = read(".github/workflows/baseline-guard.yml");
const backendWorkflow = read(".github/workflows/backend-integration.yml");

assert(baselineWorkflow.includes("infra/local/compose/compose.yaml"), "baseline CI must validate the canonical Compose topology");
assert(!baselineWorkflow.includes("compose.integration.yaml"), "baseline CI retains parallel Compose topology");
assert(!baselineWorkflow.includes(retiredProject), "baseline CI retains parallel Compose project");
assert(!backendWorkflow.includes("compose.integration.yaml"), "backend CI retains parallel Compose topology");
assert(!backendWorkflow.includes(retiredProject), "backend CI retains parallel Compose project");

for (const stale of [
  "tools/dev/doctor.ps1",
  "verify-integration-runtime.ps1",
  "ensure-local-env.ps1",
  "127.0.0.1:13001",
]) {
  assert(!baselineWorkflow.includes(stale), `baseline CI retains stale local-runtime token: ${stale}`);
  assert(!backendWorkflow.includes(stale), `backend CI retains stale local-runtime token: ${stale}`);
}

for (const command of [
  "pnpm runtime:up",
  "pnpm runtime:doctor",
  "pnpm runtime:reset",
  "pnpm control",
  "pnpm client",
  "pnpm partner",
  "pnpm captain",
  "pnpm field",
]) {
  assert(!baselineWorkflow.includes(command), `baseline CI must not invoke local runtime command: ${command}`);
  assert(!backendWorkflow.includes(command), `backend CI must not invoke local runtime command: ${command}`);
}

assert(!baselineWorkflow.includes(runtimeOwner), "baseline CI must not execute the local runtime owner");
assert(!backendWorkflow.includes(runtimeOwner), "backend CI must not execute the local runtime owner");
assert(!/\bnext\s+(?:dev|start)\b/.test(baselineWorkflow), "baseline CI must not launch Control Panel runtime");
assert(!/\bnext\s+(?:dev|start)\b/.test(backendWorkflow), "backend CI must not launch Control Panel runtime");
assert(!/docker compose[^\n]*(?:\bup\b|\bdown\b|\bstart\b|\bstop\b|\brestart\b)/i.test(baselineWorkflow), "baseline CI must not own runtime lifecycle");

assert(backendWorkflow.includes("infra/local/compose/compose.yaml"), "backend CI must reuse the canonical Compose service definitions");
assert(backendWorkflow.includes("--env-file infra/local/compose/.env.example"), "backend CI must use committed deterministic test configuration");
assert(backendWorkflow.includes("postgres mailpit identity dsh"), "backend CI must start only the backend integration service roots");
assert(
  backendWorkflow.includes("for local_only in control js-deps metro-client metro-partner metro-captain metro-field; do"),
  "backend CI must fail if any local-only runtime service is created",
);
assert(backendWorkflow.includes("REMOTE_CI_LOCAL_RUNTIME_SERVICES=0"), "backend CI must emit explicit zero-local-runtime proof");
assert(backendWorkflow.includes("verify-identity-runtime.mjs"), "backend CI must retain Identity runtime semantic proof");
assert(backendWorkflow.includes("verify-dsh-runtime.mjs"), "backend CI must retain DSH runtime semantic proof");
assert(backendWorkflow.includes("verify-migration-v13-to-v15.mjs"), "backend CI must retain migration proof");

// DOCKER_CUTOVER_ROOT_CLOSURE_GUARD_BEGIN
assert(
  runtime.includes('for ($attempt = 1; $attempt -le 12; $attempt++)'),
  "mobile LAN readiness must retain bounded retry for Windows portproxy activation",
);

const resetRuntimeBlock = runtime.slice(
  runtime.indexOf("function Reset-CanonicalRuntime"),
  runtime.indexOf("function Start-ControlPanel"),
);

for (const key of [
  "SAMRIM_IDENTITY_PORT",
  "SAMRIM_DSH_PORT",
  "SAMRIM_MAILPIT_WEB_PORT",
  "SAMRIM_CONTROL_PORT",
  "SAMRIM_APP_CLIENT_METRO_PORT",
  "SAMRIM_APP_PARTNER_METRO_PORT",
  "SAMRIM_APP_CAPTAIN_METRO_PORT",
  "SAMRIM_APP_FIELD_METRO_PORT",
]) {
  assert(
    resetRuntimeBlock.includes(key),
    `runtime reset must prove Docker-owned port is free: ${key}`,
  );
}

const dockerIgnore = read(".dockerignore");
for (const ignored of [".bthwani-local/", ".diagnostics/"]) {
  assert(
    dockerIgnore.split(/\r?\n/).includes(ignored),
    `.dockerignore must exclude local-only Docker context path: ${ignored}`,
  );
}
// DOCKER_CUTOVER_ROOT_CLOSURE_GUARD_END
// FAST_DOCKER_DEV_GUARD_BEGIN
const controlNextConfig = read("apps/control-panel/next.config.mjs");
assert(
  controlNextConfig.includes('allowedDevOrigins: ["127.0.0.1"]'),
  "Control Panel dev server must explicitly allow the canonical 127.0.0.1 origin",
);
assert(
  compose.includes("samrim-js-control-next:/workspace/apps/control-panel/.next"),
  "Control Panel .next cache must live on a Docker Linux volume",
);
assert(
  compose.includes("  samrim-js-control-next:"),
  "Control Panel .next Docker volume must be declared",
);
for (const image of [
  "samrim-local-identity-migrate:dev",
  "samrim-local-identity:dev",
  "samrim-local-dsh-migrate:dev",
  "samrim-local-dsh:dev",
]) {
  assert(compose.includes(`image: ${image}`), `canonical backend image name missing: ${image}`);
}
assert(
  runtime.includes(".bthwani-local\\runtime-build-state.json"),
  "runtime must persist local build fingerprints under the ignored .bthwani-local authority",
);
assert(
  runtime.includes("function Reconcile-CanonicalBuildImages"),
  "runtime must own change-aware image reconciliation",
);
assert(
  runtime.includes("BUILD_RECONCILE=REUSED"),
  "runtime must prove unchanged image reuse",
);
assert(
  !runtime.includes("@('up','-d','--build'"),
  "runtime:up must not build every image unconditionally",
);
assert(
  runtime.includes("@('up','-d','--no-build'"),
  "runtime:up must explicitly prohibit implicit Compose builds after reconciliation",
);
// FAST_DOCKER_DEV_GUARD_END
if (failures.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("CANONICAL_LOCAL_COMPOSE_FILES=1");
console.log("CANONICAL_LOCAL_COMPOSE_PROJECTS=1");
console.log("PUBLIC_RUNTIME_EXECUTORS=1");
console.log("SHADOW_RUNTIME_EXECUTORS=0");
console.log("CANONICAL_RUNTIME_OWNER=tools/dev/runtime.ps1");
console.log("IDENTITY_OWNER=DOCKER");
console.log("DSH_OWNER=DOCKER");
console.log("CONTROL_PANEL_OWNER=DOCKER");
console.log("MOBILE_OWNER=DOCKER");
console.log("PARALLEL_LOCAL_RUNTIME_AUTHORITY=0");
console.log("NATIVE_BACKEND_START_PATHS=0");
console.log("PORT_FALLBACK_PATHS=0");
console.log("CONTROL_PANEL_ALTERNATE_ORIGINS=0");
console.log("MOBILE_SHADOW_LAUNCHERS=0");
console.log("REMOTE_CI_LOCAL_RUNTIME_SERVICES=0");
console.log(`CONTROL_PANEL_ORIGIN=${controlOrigin}`);
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
