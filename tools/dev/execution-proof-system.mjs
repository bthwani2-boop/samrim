import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const self = "tools/dev/execution-proof-system.mjs";
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const data = (p) => JSON.parse(read(p));

const workflows = fs.readdirSync(path.join(root, ".github/workflows"))
  .filter((x) => /\.ya?ml$/.test(x))
  .sort();
const expected = ["ci-policy.yml","ci-runtime.yml","ci-security.yml","ci-static.yml"];
if (JSON.stringify(workflows) !== JSON.stringify(expected)) failures.push("workflow set drifted");

for (const [file, name] of [
  ["ci-static.yml","name: CI Static"],
  ["ci-runtime.yml","name: CI Runtime"],
  ["ci-security.yml","name: CI Security"],
  ["ci-policy.yml","name: CI Policy"],
]) {
  if (!read(".github/workflows/" + file).includes(name)) failures.push(file + ": canonical gate name missing");
}

const legacy = ["backend-integration.yml","baseline-guard.yml","control-panel-e2e.yml","pr-policy.yml","secret-safety.yml"];
const tracked = execFileSync("git", ["ls-files","-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
function readTrackedRegularFile(absolute) {
  let descriptor;
  try {
    const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
    if (!fs.fstatSync(descriptor).isFile()) return null;
    return fs.readFileSync(descriptor);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ELOOP") return null;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
for (const file of tracked) {
  const rel = file.replaceAll("\\","/");
  if (rel === self) continue;
  const abs = path.join(root, rel);
  const bytes = readTrackedRegularFile(abs);
  if (!bytes || bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const old of legacy) if (text.includes(old)) failures.push(rel + ": legacy workflow reference " + old);
}

const projects = tracked.filter((x) => /(^|\/)project\.json$/.test(x));
for (const file of projects) {
  const project = data(file);
  for (const tag of project.tags ?? []) if (String(tag).startsWith("ci-")) failures.push(file + ": retired CI scope tag " + tag);
}

const ci = data(".github/project.json");
const wantedDeps = ["control-panel","dsh-backend","identity-backend","infra","wlt-backend","workspace-tooling"].sort();
if (JSON.stringify([...(ci.implicitDependencies ?? [])].sort()) !== JSON.stringify(wantedDeps)) failures.push("repository-ci dependency cone drifted");
if (ci.targets?.["runtime-integration"]?.cache !== false) failures.push("runtime-integration must be cache=false");
if (ci.targets?.["runtime-images"]?.cache !== false) failures.push("runtime-images must be cache=false");
if (!(ci.targets?.["runtime-images"]?.dependsOn ?? []).includes("^ci-image")) failures.push("runtime-images must schedule dependency ci-image targets");
if (ci.targets?.["execution-proof-system"]?.cache !== true) failures.push("execution-proof-system must be cache=true");
if (!(ci.targets?.["execution-proof-system"]?.inputs ?? []).includes("{workspaceRoot}/**/*")) failures.push("execution-proof-system repository-wide cache input missing");
for (const old of ["tooling-lint","go-workspace-sync"]) if (ci.targets?.[old]) failures.push("repository-ci duplicate target " + old);

const tooling = data("tools/dev/project.json");
for (const target of ["lint","go-workspace-sync","structural-hygiene","knowledge-materialize","cache-contracts"]) {
  if (tooling.targets?.[target]?.cache !== true) failures.push("workspace-tooling:" + target + " must be cache=true");
}
const knowledgeOutput = tooling.targets?.["knowledge-materialize"]?.outputs ?? [];
if (!knowledgeOutput.includes("{workspaceRoot}/.cache/bthwani-knowledge")) failures.push("knowledge-materialize stable output missing");
for (const target of ["docs-command-parity", "docs-config-parity", "knowledge-system", "knowledge-references"]) {
  if (!(tooling.targets?.[target]?.dependsOn ?? []).includes("knowledge-materialize")) failures.push("workspace-tooling:" + target + " must depend on the single knowledge writer");
}
const structural = JSON.stringify(tooling.targets?.["structural-hygiene"]?.inputs ?? []);
if (!structural.includes("git ls-files -s") || !structural.includes("git ls-files --eol")) failures.push("structural-hygiene Git index inputs missing");
for (const workflow of expected) {
  if (!(tooling.namedInputs?.knowledge ?? []).includes("{workspaceRoot}/.github/workflows/" + workflow)) failures.push("knowledge input missing " + workflow);
}

for (const [file,target] of [
  ["apps/control-panel/project.json","e2e"],
  ["apps/control-panel/project.json","browser-live-proof"],
  ["services/identity/backend/project.json","migration-proof"],
  ["services/identity/backend/project.json","runtime-proof"],
  ["services/identity/backend/project.json","ci-image"],
  ["services/dsh/backend/project.json","baseline-proof"],
  ["services/dsh/backend/project.json","runtime-proof"],
  ["services/dsh/backend/project.json","ci-image"],
  ["services/wlt/backend/project.json","schema-proof"],
  ["services/wlt/backend/project.json","ci-image"],
]) {
  if (data(file).targets?.[target]?.cache !== false) failures.push(file + ":" + target + " must be cache=false");
}
if (data("apps/control-panel/project.json").targets?.["e2e-live"]) failures.push("duplicate control-panel:e2e-live remains");

const controlTargets = data("apps/control-panel/project.json").targets ?? {};
if (JSON.stringify(controlTargets["browser-live-proof"]?.dependsOn ?? []) !== JSON.stringify(["e2e"])) {
  failures.push("control-panel browser proof ordering drifted");
}
const runtimeChain = [
  ["services/identity/backend/project.json","migration-proof","control-panel","browser-live-proof"],
  ["services/dsh/backend/project.json","baseline-proof","identity-backend","migration-proof"],
  ["services/identity/backend/project.json","runtime-proof","dsh-backend","baseline-proof"],
  ["services/wlt/backend/project.json","schema-proof","identity-backend","runtime-proof"],
  ["services/dsh/backend/project.json","runtime-proof","wlt-backend","schema-proof"],
];
for (const [file,target,project,dependencyTarget] of runtimeChain) {
  const dependsOn = data(file).targets?.[target]?.dependsOn ?? [];
  const expectedDependency = JSON.stringify([{ projects: [project], target: dependencyTarget }]);
  if (JSON.stringify(dependsOn) !== expectedDependency) failures.push(file + ":" + target + " runtime ordering drifted");
}

const runtimeOwner = read("tools/dev/run-ci-runtime-proof.mjs");
if (!runtimeOwner.includes('const terminalTarget = "dsh-backend:runtime-proof"')) failures.push("runtime task graph root drifted");
for (const duplicate of [
  "control-panel:browser-live-proof",
  "identity-backend:migration-proof",
  "dsh-backend:baseline-proof",
  "identity-backend:runtime-proof",
  "wlt-backend:schema-proof",
]) {
  if (runtimeOwner.includes(duplicate)) failures.push("runtime owner contains duplicate direct target " + duplicate);
}

for (const app of ["app-client","app-partner","app-captain","app-field"]) {
  const deps = data("apps/" + app + "/project.json").implicitDependencies ?? [];
  if (!deps.includes("mobile-tooling")) failures.push(app + ": mobile-tooling dependency edge missing");
}

for (const [file,targets] of [
  ["services/identity/backend/project.json",["build","vet","unit"]],
  ["services/identity/clients/go/project.json",["vet","unit"]],
  ["services/dsh/backend/project.json",["build","vet","unit"]],
  ["services/wlt/backend/project.json",["build","vet","unit"]],
]) {
  const project = data(file);
  for (const target of targets) {
    if (!(project.targets?.[target]?.inputs ?? []).includes("goToolchain")) failures.push(file + ":" + target + " missing goToolchain input");
  }
}

const local = read("tools/dev/verify-local-candidate.ps1");
if (local.includes("git -C $Repo diff --name-only") || local.includes("--changed --since")) failures.push("local parallel affected engine remains");
if (!local.includes("nx affected -t lint format-check typecheck unit contract build vet export-smoke")) failures.push("local Nx affected target set drifted");
if (!local.includes("cache-contracts")) failures.push("local cache contract proof missing");
if (local.includes("--projects=workspace-tooling")) failures.push("local CI project allowlist remains");

const staticCi = read(".github/workflows/ci-static.yml");
if (staticCi.includes("--changed --since") || staticCi.includes("go work sync")) failures.push("static CI parallel/mutating proof remains");
if (staticCi.includes("run: node tools/dev/knowledge-source.mjs") || staticCi.includes("nx run workspace-tooling:knowledge-materialize")) failures.push("static CI duplicates knowledge materialization outside the Nx task graph");
for (const required of [
  "cache-contracts",
  "workspace-tooling:go-workspace-sync",
  "repository-ci:execution-proof-system",
  "nx affected -t lint,format-check,typecheck,unit,contract,build,export-smoke,vet",
  "run-ci-command.mjs static-install",
  "run-ci-command.mjs static-affected",
  "run-ci-command.mjs windows-install",
  "run-ci-command.mjs windows-export-affected",
  "NX_NO_CLOUD:",
  "capture-ci-failure.mjs --kind=static-linux",
  "capture-ci-failure.mjs --kind=static-windows",
  "report-ci-performance.mjs",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
]) {
  if (!staticCi.includes(required)) failures.push("static CI missing " + required);
}
if (staticCi.includes("--projects=workspace-tooling") || staticCi.includes("workspace-tooling:lint")) {
  failures.push("static CI retains a manual project allowlist or duplicate tooling lint");
}
if (staticCi.includes("windows-export-full -- pnpm exec nx run-many -t export-smoke --projects=")) failures.push("scheduled Windows full regression has a manual project allowlist");

const runtimeCi = read(".github/workflows/ci-runtime.yml");
for (const forbidden of ["node tools/dev/verify-identity-","node tools/dev/verify-dsh-","pnpm --dir apps/control-panel test:e2e:live","tag:ci-"]) {
  if (runtimeCi.includes(forbidden)) failures.push("runtime CI direct/shadow proof remains: " + forbidden);
}
if (runtimeCi.includes("docker/build-push-action@")) failures.push("runtime CI contains parallel Docker image owner");
if (runtimeCi.includes("up -d --build")) failures.push("runtime CI rebuilds images through Compose");
if ((runtimeCi.match(/docker\/setup-buildx-action@/g) ?? []).length !== 1) failures.push("runtime CI must configure Buildx exactly once");
if (runtimeCi.indexOf("Resolve runtime integration scope through Nx") > runtimeCi.indexOf("Set up Buildx")) failures.push("Buildx setup occurs before Nx affected scope");
for (const required of [
  "NX_NO_CLOUD: \"true\"",
  "--projects=repository-ci",
  "repository-ci:runtime-images",
  "repository-ci:runtime-integration",
  "docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e",
  "crazy-max/ghaction-github-runtime@04d248b84655b509d8c44dc1d6f990c879747487",
  "run-ci-command.mjs runtime-install",
  "run-ci-command.mjs runtime-playwright-install",
  "run-ci-command.mjs runtime-images",
  "run-ci-command.mjs runtime-start",
  "run-ci-command.mjs runtime-integration",
  "up -d --no-build",
  "capture-ci-failure.mjs --kind=runtime",
  "report-ci-performance.mjs",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
]) if (!runtimeCi.includes(required)) failures.push("runtime CI missing " + required);
const budgets = data(".github/ci-performance-budgets.json");
if (budgets.schema !== 1 || budgets.mode !== "observe") failures.push("CI performance budget contract drifted");
if (budgets.mode === "observe") {
  for (const workflow of expected) {
    if (read(".github/workflows/" + workflow).includes("start-nx-agents")) {
      failures.push("Nx Agents were enabled before measured distribution admission: " + workflow);
    }
  }
  const ciConfig = path.join(root, ".nx", "ci-config.yaml");
  if (fs.existsSync(ciConfig)) failures.push(".nx/ci-config.yaml exists before measured distribution admission");
}
for (const name of [
  "static-install",
  "static-affected",
  "static-full",
  "windows-install",
  "windows-export-affected",
  "windows-export-full",
  "runtime-install",
  "runtime-playwright-install",
  "runtime-images",
  "runtime-start",
  "runtime-integration",
]) {
  if (!Number.isFinite(budgets.budgetsMs?.[name])) failures.push("CI performance budget missing " + name);
}
const knownBudgets = new Set(Object.keys(budgets.budgetsMs ?? {}));
if (!Array.isArray(budgets.enforcedBudgets) || new Set(budgets.enforcedBudgets).size !== budgets.enforcedBudgets.length || budgets.enforcedBudgets.some((name) => !knownBudgets.has(name))) failures.push("CI performance enforcement must select unique defined budgets");
const controlPanelBuildInputs = JSON.stringify(data("apps/control-panel/project.json").targets?.build?.inputs ?? []);
if (!controlPanelBuildInputs.includes("controlPanelBuildEnvironment")) failures.push("Control Panel build environment cache input missing");
const controlPanelEnvironment = JSON.stringify(data("nx.json").namedInputs?.controlPanelBuildEnvironment ?? []);
if (!controlPanelEnvironment.includes("hash-control-panel-secret-input.mjs")) failures.push("Control Panel secret-file hash input missing");
if (tooling.targets?.["cache-contracts"]?.options?.command !== "node tools/dev/verify-cache-contracts.mjs") failures.push("workspace-tooling cache contract owner drifted");

const imageBuilder = read("tools/dev/build-ci-image.mjs");
if (!imageBuilder.includes('process.env.GITHUB_EVENT_NAME !== "pull_request"')) failures.push("BuildKit PR cache write fence missing");
if (!imageBuilder.includes('"--cache-from", "type=gha,version=2,scope=" + scope')) failures.push("BuildKit reusable cache v2 read missing");
if (!imageBuilder.includes('"--cache-to", "type=gha,version=2,mode=max,scope=" + scope')) failures.push("BuildKit trusted cache v2 write missing");
const failureCapture = read("tools/dev/capture-ci-failure.mjs");
if (!failureCapture.includes("function redact(") || !failureCapture.includes("redactTree(outDir)")) failures.push("failure package sanitization is not applied to every text artifact");
if (failureCapture.includes('fs.copyFileSync(envFile')) failures.push("failure package must not copy runtime env secrets");
if (failureCapture.includes("apps/control-panel/test-results") || failureCapture.includes("apps/control-panel/playwright-report")) failures.push("failure package copies raw Playwright traces or reports");
const nxCloudVerifier = read("tools/dev/verify-nx-cloud-ci.mjs");
if (!nxCloudVerifier.includes("local-only-untrusted-pr")) failures.push("untrusted PR Nx Cloud fallback missing");

const securityCi = read(".github/workflows/ci-security.yml");
for (const required of [
  "node tools/dev/verify-secret-safety.mjs",
]) if (!securityCi.includes(required)) failures.push("security CI missing " + required);
if (securityCi.includes("github/codeql-action/") || securityCi.includes("security-events: write")) failures.push("advanced CodeQL duplicates the enabled GitHub default setup");
for (const workflow of expected) {
  const source = read(".github/workflows/" + workflow);
  if (!source.includes("node tools/dev/verify-ci-exact-sha.mjs")) failures.push(workflow + ": shared exact-SHA guard missing");
}

if (failures.length) {
  console.error("EXECUTION_PROOF_SYSTEM=FAIL");
  for (const item of [...new Set(failures)].sort()) console.error("  " + item);
  process.exit(1);
}
console.log("EXECUTION_PROOF_SYSTEM=PASS workflows=4 legacy_refs=0 parallel_affected=0 ci_scope_tags=0 duplicate_owners=0");
