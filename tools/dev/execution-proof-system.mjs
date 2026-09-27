import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const data = (relative) => JSON.parse(read(relative));
const assert = (condition, message) => { if (!condition) failures.push(message); };

const ciWorkflowNames = ["ci-policy.yml", "ci-runtime.yml", "ci-security.yml", "ci-static.yml"];
const observationWorkflowNames = ["sonar-observe.yml"];
const workflowNames = [...ciWorkflowNames, ...observationWorkflowNames].sort();
const discovered = fs.readdirSync(path.join(root, ".github/workflows"))
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();
assert(JSON.stringify(discovered) === JSON.stringify(workflowNames), "canonical workflow set drifted");

for (const [file, gate] of [
  ["ci-policy.yml", "name: CI Policy"],
  ["ci-runtime.yml", "name: CI Runtime"],
  ["ci-security.yml", "name: CI Security"],
  ["ci-static.yml", "name: CI Static"],
]) {
  const body = read(`.github/workflows/${file}`);
  assert(body.includes(gate), `${file} canonical gate name missing`);
  assert(body.includes("node tools/dev/verify-ci-exact-sha.mjs"), `${file} exact candidate guard missing`);
}

const ciProject = data(".github/project.json");
assert((ciProject.implicitDependencies ?? []).length === 0, "repository-ci must not own a blanket dependency cone");
assert(ciProject.targets?.["runtime-integration"]?.cache === false, "repository-ci:runtime-integration must be cache=false");
assert(!ciProject.targets?.["runtime-images"], "repository-ci must not own runtime image scope");
assert(ciProject.targets?.["execution-proof-system"]?.cache === true, "repository-ci:execution-proof-system must be cache=true");
const executionInputs = ciProject.targets?.["execution-proof-system"]?.inputs ?? [];
assert(!executionInputs.includes("{workspaceRoot}/**/*"), "execution-proof-system must not hash the whole repository");
assert(executionInputs.includes("{workspaceRoot}/tools/dev/runtime-proof/**/*"), "execution-proof-system must include runtime router source");

const tooling = data("tools/dev/project.json");
assert(!tooling.namedInputs?.repository, "workspace-tooling retains ambiguous repository-wide input");
for (const target of ["lint", "go-workspace-sync", "structural-hygiene", "knowledge-materialize", "cache-contracts"]) {
  assert(tooling.targets?.[target]?.cache === true, `workspace-tooling:${target} must be cache=true`);
}
const trackedContent = JSON.stringify(tooling.namedInputs?.trackedRepositoryContent ?? []);
assert(trackedContent.includes("git ls-files -s"), "tracked repository content must use Git index hashes");
assert(!trackedContent.includes("{workspaceRoot}/**/*"), "tracked repository content must not make Nx hash the entire tree");
const structureInput = JSON.stringify(tooling.namedInputs?.repositoryStructure ?? []);
for (const token of ["REPOSITORY-STRUCTURE.md", "**/project.json", "git ls-files"]) assert(structureInput.includes(token), `repository structure input missing ${token}`);
const hygieneInput = JSON.stringify(tooling.namedInputs?.structuralHygiene ?? []);
for (const token of ["git ls-files -s", "git ls-files --eol", ".gitattributes", "**/package.json", "**/project.json"]) assert(hygieneInput.includes(token), `structural hygiene input missing ${token}`);
assert((tooling.targets?.["knowledge-materialize"]?.outputs ?? []).includes("{workspaceRoot}/.cache/bthwani-knowledge"), "knowledge materialization output drifted");
for (const target of ["docs-command-parity", "docs-config-parity", "knowledge-system", "knowledge-references"]) assert((tooling.targets?.[target]?.dependsOn ?? []).includes("knowledge-materialize"), `workspace-tooling:${target} must depend on knowledge-materialize`);

const control = data("apps/control-panel/project.json");
assert(control.targets?.e2e?.cache === false, "control-panel:e2e must be cache=false");
assert(control.targets?.["browser-live-proof"]?.cache === false, "control-panel:browser-live-proof must be cache=false");
assert(JSON.stringify(control.targets?.["browser-live-proof"]?.dependsOn ?? []) === JSON.stringify(["e2e"]), "control-panel browser proof must depend only on local e2e");
assert(!control.targets?.["e2e-live"], "duplicate control-panel:e2e-live remains");

for (const [file, independentTargets] of [
  ["services/identity/backend/project.json", ["migration-proof", "runtime-proof"]],
  ["services/dsh/backend/project.json", ["baseline-proof", "runtime-proof"]],
  ["services/wlt/backend/project.json", ["schema-proof"]],
]) {
  const project = data(file);
  for (const target of independentTargets) {
    assert(project.targets?.[target]?.cache === false, `${file}:${target} must be cache=false`);
    assert((project.targets?.[target]?.dependsOn ?? []).length === 0, `${file}:${target} retains cross-lane runtime ordering`);
  }
}
const wlt = data("services/wlt/backend/project.json");
assert(wlt.targets?.["financial-invariants"]?.cache === false, "wlt financial invariants must be cache=false");
assert(JSON.stringify(wlt.targets?.["financial-invariants"]?.dependsOn ?? []) === JSON.stringify(["schema-proof"]), "wlt financial invariants must depend only on local schema-proof");

const routerProject = data("tools/dev/runtime-proof/project.json");
assert(routerProject.name === "runtime-proof-routing", "runtime router Nx owner name drifted");
assert(routerProject.targets?.resolve?.cache === false, "runtime router resolution must be cache=false");
assert(routerProject.targets?.unit?.cache === true, "runtime router tests must be cache=true");

const router = read("tools/dev/runtime-proof/resolve.mjs");
for (const token of [
  '"nx", "show", "projects", "--affected"',
  "runtime-sensitive Nx projects lack runtime classification",
  "full-escalation:",
  "CI_RUNTIME_TARGETS=",
  "CI_RUNTIME_IMAGES=",
  "CI_RUNTIME_SERVICES=",
]) assert(router.includes(token), `runtime router missing ${token}`);
assert(!router.includes("git diff") && !router.includes("git status"), "runtime router must consume Nx affected truth instead of a parallel Git affected engine");

const routerTests = read("tools/dev/runtime-proof/resolve.test.mjs");
for (const token of [
  "control-only change selects only control runtime lane",
  "identity scope selects only identity runtime lane",
  "runtime-sensitive owner without classification fails closed",
  "scheduled/full regression selects every canonical lane",
]) assert(routerTests.includes(token), `runtime router tests missing ${token}`);

const runtimeRunner = read("tools/dev/run-ci-runtime-proof.mjs");
assert(runtimeRunner.includes("CI_RUNTIME_TARGETS"), "runtime runner must consume routed targets");
assert(runtimeRunner.includes("allowedTargets"), "runtime runner must validate target ownership");
assert(!runtimeRunner.includes("terminalTarget"), "runtime runner retains a terminal proof root");

const runtimeWorkflow = read(".github/workflows/ci-runtime.yml");
for (const token of [
  "runtime-proof-routing:resolve",
  "steps.scope.outputs.targets",
  "steps.scope.outputs.images",
  "steps.scope.outputs.services",
  "steps.scope.outputs.browser",
  "CI_RUNTIME_TARGETS:",
  "repository-ci:runtime-integration",
  "run-ci-command.mjs runtime-images",
  "run-ci-command.mjs runtime-start",
  "run-ci-command.mjs runtime-integration",
  "up -d --no-build",
]) assert(runtimeWorkflow.includes(token), `runtime workflow missing ${token}`);
for (const forbidden of [
  "--projects=repository-ci",
  "repository-ci:runtime-images",
  "tag:ci-",
  "up -d --build",
  "docker/build-push-action@",
  "node tools/dev/verify-identity-",
  "node tools/dev/verify-dsh-",
  "pnpm --dir apps/control-panel test:e2e:live",
]) assert(!runtimeWorkflow.includes(forbidden), `runtime workflow retains superseded scope/proof path: ${forbidden}`);
assert(runtimeWorkflow.indexOf("Resolve affected runtime proof lanes through Nx") < runtimeWorkflow.indexOf("Set up Buildx"), "runtime scope must resolve before Buildx setup");

const staticWorkflow = read(".github/workflows/ci-static.yml");
assert(staticWorkflow.includes("repository-ci:execution-proof-system"), "static workflow missing execution proof system");
assert(staticWorkflow.includes("nx affected -t lint,format-check,typecheck,unit,contract,build,export-smoke,vet"), "static workflow affected target set drifted");
assert(!staticWorkflow.includes("--changed --since"), "static workflow contains a parallel affected engine");

const localVerifier = read("tools/dev/verify-local-candidate.ps1");
assert(localVerifier.includes("nx affected -t lint format-check typecheck unit contract build vet"), "local verifier lost affected static proof");
assert(!localVerifier.includes("runtime:up") && !localVerifier.includes("runtime:doctor"), "local verifier must remain runtime-free");

const budgets = data(".github/ci-performance-budgets.json");
assert(budgets.schema === 1, "CI performance budget schema drifted");
assert(["observe", "enforce"].includes(budgets.mode), "CI performance mode invalid");
assert(Array.isArray(budgets.enforcedBudgets), "CI enforced budget list missing");
const knownBudgets = new Set(Object.keys(budgets.budgetsMs ?? {}));
assert(new Set(budgets.enforcedBudgets).size === budgets.enforcedBudgets.length, "CI enforced budget list contains duplicates");
assert(budgets.enforcedBudgets.every((name) => knownBudgets.has(name)), "CI enforced budget references undefined budget");
for (const file of workflowNames) {
  const body = read(`.github/workflows/${file}`);
  if (budgets.mode === "observe") assert(!body.includes("start-nx-agents"), `${file} enables distributed execution before measured admission`);
}

const sonarWorkflow = read(".github/workflows/sonar-observe.yml");
assert(sonarWorkflow.includes("name: Sonar Quality Observe"), "Sonar observation workflow name missing");
assert(sonarWorkflow.includes("uses: SonarSource/sonarqube-scan-action@"), "Sonar observation action missing");
assert(sonarWorkflow.includes("SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}"), "Sonar observation token binding missing");
assert(!sonarWorkflow.includes("sonar.qualitygate.wait=true"), "Sonar observation must not wait on or enforce the quality gate");
for (const [, reference] of sonarWorkflow.matchAll(/^\s+uses:\s+([^\s]+)$/gm)) {
  const [, ref] = reference.split("@");
  assert(/^[0-9a-f]{40}$/.test(ref ?? ""), `Sonar observation action is not pinned to a full commit SHA: ${reference}`);
}
const sonarProperties = new Map(
  read("sonar-project.properties")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return separator < 0 ? [line, ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
);
for (const key of ["sonar.organization", "sonar.projectKey", "sonar.projectName", "sonar.sources"]) {
  assert(Boolean(sonarProperties.get(key)), `Sonar observation configuration is missing ${key}`);
}
assert(/^[A-Za-z0-9-]+$/.test(sonarProperties.get("sonar.organization") ?? ""), "Sonar organization key is malformed");
assert(/^[A-Za-z0-9_.:-]+$/.test(sonarProperties.get("sonar.projectKey") ?? ""), "Sonar project key is malformed");

if (failures.length) {
  console.error("EXECUTION_PROOF_SYSTEM=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("EXECUTION_PROOF_SYSTEM=PASS workflows=4 observation_workflows=1 runtime_router=nx affected_scope=claim-driven runtime_dag=decoupled cache_inputs=causal");
