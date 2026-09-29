import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const data = (relative) => JSON.parse(read(relative));
const assert = (condition, message) => { if (!condition) failures.push(message); };

const ciWorkflowNames = ["ci-policy.yml", "ci-runtime.yml", "ci-security.yml", "ci-static.yml"];
const observationWorkflowNames = ["sonar-observe.yml"];
const workflowNames = [...ciWorkflowNames, ...observationWorkflowNames].sort(compareStrings);
const discovered = fs.readdirSync(path.join(root, ".github/workflows")).filter((name) => /\.ya?ml$/.test(name)).sort((left, right) => left.localeCompare(right));
assert(JSON.stringify(discovered) === JSON.stringify(workflowNames), "canonical workflow set drifted");

for (const [file, gate] of [["ci-policy.yml", "name: CI Policy"], ["ci-runtime.yml", "name: CI Runtime"], ["ci-security.yml", "name: CI Security"], ["ci-static.yml", "name: CI Static"]]) {
  const body = read(`.github/workflows/${file}`);
  assert(body.includes(gate), `${file} canonical gate name missing`);
  assert(body.includes("node tools/dev/verify-ci-exact-sha.mjs"), `${file} exact candidate guard missing`);
  assert(body.includes("node tools/dev/capture-ci-failure.mjs"), `${file} machine failure capture missing`);
  assert(body.includes("actions/upload-artifact@"), `${file} failure artifact upload missing`);
}

const ciProject = data(".github/project.json");
assert((ciProject.implicitDependencies ?? []).length === 0, "repository-ci must not own a blanket dependency cone");
assert(ciProject.targets?.["runtime-integration"]?.cache === false, "repository-ci:runtime-integration must be cache=false");
assert(!ciProject.targets?.["runtime-images"], "repository-ci must not own runtime image scope");
assert(ciProject.targets?.["execution-proof-system"]?.cache === true, "repository-ci:execution-proof-system must be cache=true");
const executionInputs = ciProject.targets?.["execution-proof-system"]?.inputs ?? [];
assert(!executionInputs.includes("{workspaceRoot}/**/*"), "execution-proof-system must not hash the whole repository");
for (const input of ["{workspaceRoot}/tools/dev/runtime-proof/**/*", "{workspaceRoot}/tools/dev/ci-failure-diagnostics.mjs", "{workspaceRoot}/tools/dev/ci-failure-diagnostics.test.mjs", "{workspaceRoot}/tools/dev/verify-pr-policy.mjs"]) assert(executionInputs.includes(input), `execution-proof-system missing causal input ${input}`);

const tooling = data("tools/dev/project.json");
assert(!tooling.namedInputs?.repository, "workspace-tooling retains ambiguous repository-wide input");
for (const target of ["lint", "go-workspace-sync", "structural-hygiene", "knowledge-materialize", "cache-contracts"]) assert(tooling.targets?.[target]?.cache === true, `workspace-tooling:${target} must be cache=true`);
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

for (const [file, independentTargets] of [["services/identity/backend/project.json", ["migration-proof", "runtime-proof"]], ["services/dsh/backend/project.json", ["baseline-proof", "runtime-proof"]], ["services/wlt/backend/project.json", ["schema-proof"]]]) {
  const project = data(file);
  for (const target of independentTargets) {
    assert(project.targets?.[target]?.cache === false, `${file}:${target} must be cache=false`);
    assert((project.targets?.[target]?.dependsOn ?? []).length === 0, `${file}:${target} retains cross-lane runtime ordering`);
  }
}
const wlt = data("services/wlt/backend/project.json");
assert(wlt.targets?.["financial-invariants"]?.cache === false, "wlt financial invariants must be cache=false");
assert(JSON.stringify(wlt.targets?.["financial-invariants"]?.dependsOn ?? []) === JSON.stringify(["schema-proof"]), "wlt financial invariants must depend only on local schema-proof");
const dsh = data("services/dsh/backend/project.json");
assert(dsh.targets?.["runtime-fixture-cleanup"]?.cache === false, "DSH checker fixture cleanup must be uncached");
assert(control.targets?.["dsh-runtime-checker-fixture"]?.cache === false, "DSH checker fixture setup must be uncached");

const routerProject = data("tools/dev/runtime-proof/project.json");
assert(routerProject.name === "runtime-proof-routing", "runtime router Nx owner name drifted");
assert(routerProject.targets?.resolve?.cache === false, "runtime router resolution must be cache=false");
assert(routerProject.targets?.unit?.cache === true, "runtime router tests must be cache=true");
const router = read("tools/dev/runtime-proof/resolve.mjs");
for (const token of ['"nx", "show", "projects", "--affected"', "runtime-sensitive Nx projects lack runtime classification", "full-escalation:", "CI_RUNTIME_TARGETS=", "CI_RUNTIME_IMAGES=", "CI_RUNTIME_SERVICES="]) assert(router.includes(token), `runtime router missing ${token}`);
assert(!router.includes("git diff") && !router.includes("git status"), "runtime router must consume Nx affected truth instead of a parallel Git affected engine");
const routerTests = read("tools/dev/runtime-proof/resolve.test.mjs");
for (const token of ["control-only change selects only control runtime lane", "identity scope selects only identity runtime lane", "runtime-sensitive owner without classification fails closed", "DSH-only runtime scope prepares one disposable Passkey checker before backend proofs", "combined Control and DSH scope creates the checker in the existing browser proof only once", "scheduled/full regression selects every canonical lane"]) assert(routerTests.includes(token), `runtime router tests missing ${token}`);

const runtimeRunner = read("tools/dev/run-ci-runtime-proof.mjs");
assert(runtimeRunner.includes("CI_RUNTIME_TARGETS"), "runtime runner must consume routed targets");
assert(runtimeRunner.includes("allowedTargets"), "runtime runner must validate target ownership");
assert(!runtimeRunner.includes("terminalTarget"), "runtime runner retains a terminal proof root");

const runtimeWorkflow = read(".github/workflows/ci-runtime.yml");
for (const token of ["runtime-proof-routing:resolve", "steps.scope.outputs.targets", "steps.scope.outputs.images", "steps.scope.outputs.services", "steps.scope.outputs.browser", "CI_RUNTIME_TARGETS:", "repository-ci:runtime-integration", "run-ci-command.mjs runtime-images", "run-ci-command.mjs runtime-start", "run-ci-command.mjs runtime-integration", "up -d --no-build"]) assert(runtimeWorkflow.includes(token), `runtime workflow missing ${token}`);
for (const forbidden of ["--projects=repository-ci", "repository-ci:runtime-images", "tag:ci-", "up -d --build", "docker/build-push-action@", "node tools/dev/verify-identity-", "node tools/dev/verify-dsh-", "pnpm --dir apps/control-panel test:e2e:live"]) assert(!runtimeWorkflow.includes(forbidden), `runtime workflow retains superseded scope/proof path: ${forbidden}`);
assert(runtimeWorkflow.indexOf("Resolve affected runtime proof lanes through Nx") < runtimeWorkflow.indexOf("Set up Buildx"), "runtime scope must resolve before Buildx setup");

const staticWorkflow = read(".github/workflows/ci-static.yml");
assert(!/^permissions:\s*$/m.test(staticWorkflow), "ci-static permissions must be scoped to jobs");
for (const job of ["baseline", "windows"]) {
  const start = staticWorkflow.indexOf(`  ${job}:\n`);
  assert(start >= 0, `ci-static workflow is missing ${job} job`);
  const nextJob = job === "baseline" ? staticWorkflow.indexOf("\n  windows:", start + 4) : staticWorkflow.length;
  const body = staticWorkflow.slice(start, nextJob < 0 ? undefined : nextJob);
  assert(body.includes("    permissions:\n      actions: read\n      contents: read"), `ci-static ${job} job permissions are too broad or missing`);
}
assert(staticWorkflow.includes("repository-ci:execution-proof-system"), "static workflow missing execution proof system");
assert(staticWorkflow.includes("nx affected -t lint,format-check,typecheck,unit,contract,build,export-smoke,vet"), "static workflow affected target set drifted");
assert(!staticWorkflow.includes("--changed --since"), "static workflow contains a parallel affected engine");

const localVerifier = read("tools/dev/verify-local-candidate.ps1");
assert(localVerifier.includes("nx','affected"), "local verifier lost affected static proof");
assert(localVerifier.includes("--nxBail=false"), "local verifier must bounded-harvest cheap static findings");
assert(localVerifier.includes("capture-ci-failure.mjs"), "local verifier must emit the same agent diagnostic on failure");
assert(!localVerifier.includes("runtime:up") && !localVerifier.includes("runtime:doctor"), "local verifier must remain runtime-free");

const budgets = data(".github/ci-performance-budgets.json");
assert(budgets.schema === 1, "CI performance budget schema drifted");
assert(["observe", "enforce"].includes(budgets.mode), "CI performance mode invalid");
assert(Array.isArray(budgets.enforcedBudgets), "CI enforced budget list missing");
const knownBudgets = new Set(Object.keys(budgets.budgetsMs ?? {}));
assert(new Set(budgets.enforcedBudgets).size === budgets.enforcedBudgets.length, "CI enforced budget list contains duplicates");
assert(budgets.enforcedBudgets.every((name) => knownBudgets.has(name)), "CI enforced budget references undefined budget");
for (const file of workflowNames) if (budgets.mode === "observe") assert(!read(`.github/workflows/${file}`).includes("start-nx-agents"), `${file} enables distributed execution before measured admission`);

const sonarWorkflow = read(".github/workflows/sonar-observe.yml");
assert(sonarWorkflow.includes("name: Sonar Quality Observe"), "Sonar observation workflow name missing");
assert(sonarWorkflow.includes("runs-on: ubuntu-24.04") && !sonarWorkflow.includes("ubuntu-latest"), "Sonar observation runner must be pinned to ubuntu-24.04");
for (const token of ["github.ref == 'refs/heads/main'", "github.event_name == 'pull_request'", "github.event.pull_request.base.ref == 'main'", "github.event.pull_request.head.repo.full_name == github.repository"]) assert(sonarWorkflow.includes(token), `Sonar analysis scope is missing ${token}`);
assert(sonarWorkflow.includes("uses: SonarSource/sonarqube-scan-action@"), "Sonar observation action missing");
assert(sonarWorkflow.includes("services/identity/tests/contract-guard.test.mjs"), "Sonar observation must execute the Identity contract guard test");
assert(sonarWorkflow.includes("SONAR_TOKEN: $" + "{{ secrets.SONAR_TOKEN }}"), "Sonar observation token binding missing");
for (const token of ["image: postgis/postgis:16-3.4-alpine", "POSTGRES_HOST_AUTH_METHOD: trust", "DSH_DATABASE_URL: postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable", "IDENTITY_DATABASE_URL: postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable", "go -C services/dsh/backend test -coverprofile=", "go -C services/identity/backend test -coverprofile=", "go -C services/wlt/backend test -coverprofile=", "node --experimental-test-coverage --test --test-reporter=lcov", "coverage/sonar/tools-dev.lcov"]) assert(sonarWorkflow.includes(token), `Sonar coverage preparation missing ${token}`);
assert(!sonarWorkflow.includes("POSTGRES_PASSWORD:") && !sonarWorkflow.includes("sonar-proof"), "Sonar workflow must not retain a hardcoded database credential");
assert(!sonarWorkflow.includes("sonar.qualitygate.wait=true"), "Sonar observation must not wait on or enforce the quality gate");
for (const [, reference] of sonarWorkflow.matchAll(/^[ \t]+uses:[ \t]+([^\t ]+)$/gm)) {
  const [, ref] = reference.split("@");
  assert(/^[0-9a-f]{40}$/.test(ref ?? ""), `Sonar observation action is not pinned to a full commit SHA: ${reference}`);
}
const sonarProperties = new Map(read("sonar-project.properties").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => { const separator = line.indexOf("="); return separator < 0 ? [line, ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]; }));
for (const key of ["sonar.organization", "sonar.projectKey", "sonar.projectName", "sonar.sources", "sonar.tests", "sonar.test.inclusions", "sonar.go.coverage.reportPaths", "sonar.javascript.lcov.reportPaths"]) assert(Boolean(sonarProperties.get(key)), `Sonar observation configuration is missing ${key}`);
assert(/^[A-Za-z0-9-]+$/.test(sonarProperties.get("sonar.organization") ?? ""), "Sonar organization key is malformed");
assert(/^[A-Za-z0-9_.:-]+$/.test(sonarProperties.get("sonar.projectKey") ?? ""), "Sonar project key is malformed");
for (const pattern of ["**/*_test.go", "**/*.test.mjs", "**/tests/**/*.ts", "tools/dev/verify-dsh-runtime-core.mjs"]) {
  assert(sonarProperties.get("sonar.test.inclusions")?.split(",").includes(pattern), `Sonar test classification missing ${pattern}`);
  assert(sonarProperties.get("sonar.exclusions")?.split(",").includes(pattern), `Sonar source scope still includes test files matching ${pattern}`);
}
assert(!sonarProperties.has("sonar.coverage.exclusions"), "Sonar coverage exclusions must not conceal uncovered source lines");

if (failures.length) {
  console.error("EXECUTION_PROOF_SYSTEM=FAIL");
  for (const failure of [...new Set(failures)].sort(compareStrings)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("EXECUTION_PROOF_SYSTEM=PASS workflows=4 observation_workflows=1 runtime_router=nx affected_scope=claim-driven runtime_dag=decoupled diagnostics=agent-first-bounded-harvest cache_inputs=causal");
