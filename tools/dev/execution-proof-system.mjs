import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const data = (relative) => JSON.parse(read(relative));
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

function requireTokens(body, label, tokens) {
  for (const token of tokens) assert(body.includes(token), `${label} missing ${token}`);
}

function forbidTokens(body, label, tokens) {
  for (const token of tokens) assert(!body.includes(token), `${label} retains forbidden ${token}`);
}

function verifyCanonicalWorkflows() {
  const ciWorkflowNames = ["ci-policy.yml", "ci-runtime.yml", "ci-security.yml", "ci-static.yml"];
  const qualityWorkflowNames = ["sonar-observe.yml"];
  const workflowNames = [...ciWorkflowNames, ...qualityWorkflowNames].toSorted(compareStrings);
  const discovered = fs.readdirSync(path.join(root, ".github/workflows"))
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted(compareStrings);
  assert(JSON.stringify(discovered) === JSON.stringify(workflowNames), "canonical workflow set drifted");

  const gates = [
    ["ci-policy.yml", "name: CI Policy"],
    ["ci-runtime.yml", "name: CI Runtime"],
    ["ci-security.yml", "name: CI Security"],
    ["ci-static.yml", "name: CI Static"],
  ];
  for (const [file, gate] of gates) {
    const body = read(`.github/workflows/${file}`);
    requireTokens(body, file, [gate, "node tools/dev/verify-ci-exact-sha.mjs", "node tools/dev/capture-ci-failure.mjs", "actions/upload-artifact@"]) ;
  }
  return workflowNames;
}

function verifyNxOwnership() {
  const ciProject = data(".github/project.json");
  assert((ciProject.implicitDependencies ?? []).length === 0, "repository-ci must not own a blanket dependency cone");
  assert(ciProject.targets?.["runtime-integration"]?.cache === false, "repository-ci:runtime-integration must be cache=false");
  assert(!ciProject.targets?.["runtime-images"], "repository-ci must not own runtime image scope");
  assert(ciProject.targets?.["execution-proof-system"]?.cache === true, "repository-ci:execution-proof-system must be cache=true");
  const inputs = ciProject.targets?.["execution-proof-system"]?.inputs ?? [];
  assert(!inputs.includes("{workspaceRoot}/**/*"), "execution-proof-system must not hash the whole repository");
  requireTokens(JSON.stringify(inputs), "execution-proof-system inputs", [
    "{workspaceRoot}/tools/dev/runtime-proof/**/*",
    "{workspaceRoot}/tools/dev/ci-failure-diagnostics.mjs",
    "{workspaceRoot}/tools/dev/ci-failure-diagnostics.test.mjs",
    "{workspaceRoot}/tools/dev/verify-pr-policy.mjs",
  ]);

  const tooling = data("tools/dev/project.json");
  assert(!tooling.namedInputs?.repository, "workspace-tooling retains ambiguous repository-wide input");
  for (const target of ["lint", "go-workspace-sync", "structural-hygiene", "knowledge-materialize", "cache-contracts"]) {
    assert(tooling.targets?.[target]?.cache === true, `workspace-tooling:${target} must be cache=true`);
  }
  const trackedContent = JSON.stringify(tooling.namedInputs?.trackedRepositoryContent ?? []);
  requireTokens(trackedContent, "tracked repository content", ["git ls-files -s", "git diff --binary HEAD --"]);
  forbidTokens(trackedContent, "tracked repository content", ["{workspaceRoot}/**/*"]);
  requireTokens(JSON.stringify(tooling.namedInputs?.repositoryStructure ?? []), "repository structure input", ["REPOSITORY-STRUCTURE.md", "**/project.json", "git ls-files"]);
  requireTokens(JSON.stringify(tooling.namedInputs?.structuralHygiene ?? []), "structural hygiene input", ["git ls-files -s", "git ls-files --eol", "git diff --binary HEAD --", ".gitattributes", "**/package.json", "**/project.json"]);
  requireTokens(JSON.stringify(tooling.namedInputs?.knowledge ?? []), "knowledge input", ["{workspaceRoot}/**/*.md"]);
  requireTokens(JSON.stringify(tooling.namedInputs?.workspaceDependencies ?? []), "workspace dependency input", [
    "{workspaceRoot}/apps/**/*.{ts,tsx,js,jsx,mjs,cjs,go}",
    "{workspaceRoot}/services/**/*.{ts,tsx,js,jsx,mjs,cjs,go}",
    "{workspaceRoot}/packages/**/*.{ts,tsx,js,jsx,mjs,cjs,go}",
    "{projectRoot}/verify-workspace-dependencies.mjs",
  ]);
  assert((tooling.targets?.["knowledge-materialize"]?.outputs ?? []).includes("{workspaceRoot}/.cache/bthwani-knowledge"), "knowledge materialization output drifted");
  for (const target of ["docs-command-parity", "docs-config-parity", "knowledge-system", "knowledge-references"]) {
    assert((tooling.targets?.[target]?.dependsOn ?? []).includes("knowledge-materialize"), `workspace-tooling:${target} must depend on knowledge-materialize`);
  }
}

function verifyRuntimeOwnership() {
  const control = data("apps/control-panel/project.json");
  assert(control.targets?.e2e?.cache === false, "control-panel:e2e must be cache=false");
  assert(control.targets?.["browser-live-proof"]?.cache === false, "control-panel:browser-live-proof must be cache=false");
  assert(JSON.stringify(control.targets?.["browser-live-proof"]?.dependsOn ?? []) === JSON.stringify(["e2e"]), "control-panel browser proof must depend only on local e2e");
  assert(!control.targets?.["e2e-live"], "duplicate control-panel:e2e-live remains");

  const independent = [
    ["services/identity/backend/project.json", ["migration-proof", "runtime-proof"]],
    ["services/dsh/backend/project.json", ["baseline-proof", "runtime-proof", "location-proof"]],
    ["services/wlt/backend/project.json", ["schema-proof"]],
  ];
  for (const [file, targets] of independent) {
    const project = data(file);
    for (const target of targets) {
      assert(project.targets?.[target]?.cache === false, `${file}:${target} must be cache=false`);
      assert((project.targets?.[target]?.dependsOn ?? []).length === 0, `${file}:${target} retains cross-lane runtime ordering`);
    }
  }

  const wlt = data("services/wlt/backend/project.json");
  assert(wlt.targets?.["financial-invariants"]?.cache === false, "wlt financial invariants must be cache=false");
  assert(JSON.stringify(wlt.targets?.["financial-invariants"]?.dependsOn ?? []) === JSON.stringify(["schema-proof"]), "wlt financial invariants must depend only on local schema-proof");
  const dsh = data("services/dsh/backend/project.json");
  assert(!dsh.targets?.["runtime-fixture-cleanup"], "DSH checker fixtures must be discarded with the disposable CI database");
  assert(control.targets?.["dsh-runtime-checker-fixture"]?.cache === false, "DSH checker fixture setup must be uncached");
}

function verifyRuntimeRouting() {
  const routerProject = data("tools/dev/runtime-proof/project.json");
  assert(routerProject.name === "runtime-proof-routing", "runtime router Nx owner name drifted");
  assert(routerProject.targets?.resolve?.cache === false, "runtime router resolution must be cache=false");
  assert(routerProject.targets?.unit?.cache === true, "runtime router tests must be cache=true");

  const router = read("tools/dev/runtime-proof/resolve.mjs");
  requireTokens(router, "runtime router", ['"nx", "show", "projects", "--affected"', "runtime-sensitive Nx projects lack runtime classification", "full-escalation:", "CI_RUNTIME_TARGETS=", "CI_RUNTIME_IMAGES=", "CI_RUNTIME_SERVICES="]);
  forbidTokens(router, "runtime router", ["git diff", "git status"]);

  const routerTests = read("tools/dev/runtime-proof/resolve.test.mjs");
  requireTokens(routerTests, "runtime router tests", [
    "control-only change selects only control runtime lane",
    "identity scope selects only identity runtime lane",
    "runtime-sensitive owner without classification fails closed",
    "DSH-only runtime scope prepares one disposable Passkey checker before backend proofs",
    "combined Control and DSH scope creates the checker in the existing browser proof only once",
    "scheduled/full regression selects every canonical lane",
  ]);

  const runtimeRunner = read("tools/dev/run-ci-runtime-proof.mjs");
  requireTokens(runtimeRunner, "runtime runner", ["CI_RUNTIME_TARGETS", "allowedTargets"]);
  forbidTokens(runtimeRunner, "runtime runner", ["terminalTarget"]);
}

function verifyCiWorkflowTopology() {
  const runtimeWorkflow = read(".github/workflows/ci-runtime.yml");
  requireTokens(runtimeWorkflow, "runtime workflow", ["runtime-proof-routing:resolve", "steps.scope.outputs.targets", "steps.scope.outputs.images", "steps.scope.outputs.services", "steps.scope.outputs.browser", "CI_RUNTIME_TARGETS:", "repository-ci:runtime-integration", "run-ci-command.mjs runtime-images", "run-ci-command.mjs runtime-start", "run-ci-command.mjs runtime-integration", "up -d --no-build"]);
  forbidTokens(runtimeWorkflow, "runtime workflow", ["--projects=repository-ci", "repository-ci:runtime-images", "tag:ci-", "up -d --build", "docker/build-push-action@", "node tools/dev/verify-identity-", "node tools/dev/verify-dsh-", "pnpm --dir apps/control-panel test:e2e:live"]);
  assert(runtimeWorkflow.indexOf("Resolve affected runtime proof lanes through Nx") < runtimeWorkflow.indexOf("Set up Buildx"), "runtime scope must resolve before Buildx setup");

  const staticWorkflow = read(".github/workflows/ci-static.yml");
  assert(!/^permissions:\s*$/m.test(staticWorkflow), "ci-static permissions must be scoped to jobs");
  for (const job of ["baseline", "windows"]) {
    const start = staticWorkflow.indexOf(`  ${job}:\n`);
    assert(start >= 0, `ci-static workflow is missing ${job} job`);
    const nextJob = job === "baseline" ? staticWorkflow.indexOf("\n  windows:", start + 4) : staticWorkflow.length;
    const end = nextJob < 0 ? staticWorkflow.length : nextJob;
    const body = staticWorkflow.slice(start, end);
    requireTokens(body, `ci-static ${job} job`, ["    permissions:\n      actions: read\n      contents: read"]);
  }
  requireTokens(staticWorkflow, "static workflow", ["repository-ci:execution-proof-system", "nx affected -t lint,format-check,typecheck,unit,contract,build,export-smoke,vet"]);
  forbidTokens(staticWorkflow, "static workflow", ["--changed --since"]);
  requireTokens(staticWorkflow, "static workflow Nx Agents opt-in", [
    "enable_nx_agents:",
    "default: false",
    "NX_DTE_ENABLED:",
    "if: env.NX_DTE_ENABLED == 'true'",
    "pnpm dlx nx-cloud start-nx-agents",
    "if: github.event_name == 'workflow_dispatch' && env.NX_DTE_ENABLED == 'true'",
    "--outputStyle=stream --dte",
  ]);
  assert(
    staticWorkflow.indexOf("Start opt-in Nx Agents") < staticWorkflow.indexOf("Verify repository invariants through Nx"),
    "opt-in Nx Agents must start before the first Nx task in the Linux static job",
  );
  const nxCiConfig = read(".nx/ci-config.yaml");
  const nxAgentWorkflow = read(".nx/workflows/agents.yaml");
  assert(
    nxCiConfig.includes("enabled-by-default: false") &&
      nxCiConfig.includes("distribute-on: 2 linux-medium-js") &&
      nxCiConfig.includes("with-env-vars:") &&
      [
        "GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT",
        "GOOGLE_MAPS_IOS_API_KEY",
        "GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN",
        "GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN",
        "GOOGLE_MAPS_ANDROID_API_KEY_APP_FIELD",
      ].every((name) => nxCiConfig.includes(`- ${name}`) && staticWorkflow.includes(`${name}: maps-config-placeholder-`)),
    "Nx Agents must stay opt-in and capped at two medium agents",
  );
  requireTokens(nxAgentWorkflow, "Nx Agents launch template", [
    "resource-class: 'docker_linux_amd64/medium'",
    "image: 'ubuntu22.04-node24.14-v1'",
    "node=24.17.0",
    "go=1.27.1",
    "pnpm=10.34.0",
    'test "$(node -p \'process.version\')" = "v24.17.0"',
    'test "$(go env GOVERSION)" = "go1.27.1"',
    'test "$(pnpm --version)" = "10.34.0"',
  ]);

  const localVerifier = read("tools/dev/verify-local-candidate.ps1");
  requireTokens(localVerifier, "local verifier", ["nx','affected", "--nxBail=false", "capture-ci-failure.mjs"]);
  forbidTokens(localVerifier, "local verifier", ["runtime:up", "runtime:doctor"]);
}

function verifyPerformanceBudget(workflowNames) {
  const budgets = data(".github/ci-performance-budgets.json");
  assert(budgets.schema === 1, "CI performance budget schema drifted");
  assert(["observe", "enforce"].includes(budgets.mode), "CI performance mode invalid");
  assert(Array.isArray(budgets.enforcedBudgets), "CI enforced budget list missing");
  const knownBudgets = new Set(Object.keys(budgets.budgetsMs ?? {}));
  assert(new Set(budgets.enforcedBudgets).size === budgets.enforcedBudgets.length, "CI enforced budget list contains duplicates");
  assert(budgets.enforcedBudgets.every((name) => knownBudgets.has(name)), "CI enforced budget references undefined budget");
  if (budgets.mode === "observe") {
    for (const file of workflowNames.filter((name) => name !== "ci-static.yml")) {
      forbidTokens(read(`.github/workflows/${file}`), file, ["start-nx-agents"]);
    }
    const staticWorkflow = read(".github/workflows/ci-static.yml");
    requireTokens(staticWorkflow, "observe-mode Nx Agents guard", [
      "enable_nx_agents:",
      "default: false",
      "if: env.NX_DTE_ENABLED == 'true'",
      "if: github.event_name == 'workflow_dispatch' && env.NX_DTE_ENABLED == 'true'",
      "--outputStyle=stream --dte",
    ]);
    assert(
      (staticWorkflow.match(/start-nx-agents/g) ?? []).length === 1,
      "observe mode permits exactly one explicitly guarded Nx Agents start",
    );
  }
}

function sonarProperties() {
  const entries = [];
  for (const rawLine of read("sonar-project.properties").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) {
      entries.push([line, ""]);
      continue;
    }
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return new Map(entries);
}

function verifySonarQualityGate() {
  const workflow = read(".github/workflows/sonar-observe.yml");
  requireTokens(workflow, "Sonar quality workflow", [
    "name: Sonar Quality Gate",
    "name: SonarQube Cloud Quality Gate",
    "runs-on: ubuntu-24.04",
    "github.ref == 'refs/heads/main'",
    "github.event_name == 'pull_request'",
    "github.event.pull_request.base.ref == 'main'",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "uses: SonarSource/sonarqube-scan-action@",
    "services/identity/tests/contract-guard.test.mjs",
    "SONAR_TOKEN: $" + "{{ secrets.SONAR_TOKEN }}",
    "image: postgis/postgis:16-3.4-alpine",
    "POSTGRES_HOST_AUTH_METHOD: trust",
    "DSH_DATABASE_URL: postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable",
    "IDENTITY_DATABASE_URL: postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable",
    "go -C services/dsh/backend test -coverprofile=",
    "go -C services/identity/backend test -coverprofile=",
    "go -C services/wlt/backend test -coverprofile=",
    "node --experimental-test-coverage --test --test-concurrency=1",
    "--test-reporter=spec --test-reporter-destination=stdout",
    "--test-reporter=lcov --test-reporter-destination=coverage/sonar/tools-dev.lcov",
    "Read back and enforce SonarQube Cloud evidence",
    "gate_status=",
    "if [[ \"$gate_status\" != \"OK\" ]]",
    "SONAR_QUALITY_GATE=OK",
  ]);
  forbidTokens(workflow, "Sonar quality workflow", ["ubuntu-latest", "POSTGRES_PASSWORD:", "sonar-proof", "OBSERVE MODE", "Do not make this check required yet"]);

  for (const match of workflow.matchAll(/^[ \t]+uses:[ \t]+([^\t ]+)$/gm)) {
    const reference = match[1] ?? "";
    const separator = reference.lastIndexOf("@");
    const ref = separator >= 0 ? reference.slice(separator + 1) : "";
    assert(/^[0-9a-f]{40}$/.test(ref), `Sonar quality action is not pinned to a full commit SHA: ${reference}`);
  }

  const properties = sonarProperties();
  for (const key of ["sonar.organization", "sonar.projectKey", "sonar.projectName", "sonar.sources", "sonar.tests", "sonar.test.inclusions", "sonar.go.coverage.reportPaths", "sonar.javascript.lcov.reportPaths"]) {
    assert(Boolean(properties.get(key)), `Sonar quality configuration is missing ${key}`);
  }
  assert(/^[A-Za-z0-9-]+$/.test(properties.get("sonar.organization") ?? ""), "Sonar organization key is malformed");
  assert(/^[A-Za-z0-9_.:-]+$/.test(properties.get("sonar.projectKey") ?? ""), "Sonar project key is malformed");
  for (const pattern of ["**/*_test.go", "**/*.test.mjs", "**/tests/**/*.ts", "tools/dev/verify-dsh-runtime-core.mjs"]) {
    assert(properties.get("sonar.test.inclusions")?.split(",").includes(pattern), `Sonar test classification missing ${pattern}`);
    assert(properties.get("sonar.exclusions")?.split(",").includes(pattern), `Sonar source scope still includes test files matching ${pattern}`);
  }
  assert(!properties.has("sonar.coverage.exclusions"), "Sonar coverage exclusions must not conceal uncovered source lines");
}

const workflowNames = verifyCanonicalWorkflows();
verifyNxOwnership();
verifyRuntimeOwnership();
verifyRuntimeRouting();
verifyCiWorkflowTopology();
verifyPerformanceBudget(workflowNames);
verifySonarQualityGate();

if (failures.length > 0) {
  console.error("EXECUTION_PROOF_SYSTEM=FAIL");
  for (const failure of [...new Set(failures)].toSorted(compareStrings)) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("EXECUTION_PROOF_SYSTEM=PASS workflows=4 quality_workflows=1 sonar_gate=authoritative runtime_router=nx affected_scope=claim-driven runtime_dag=decoupled diagnostics=agent-first-bounded-harvest cache_inputs=causal");
