import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { discoverWindowsPlatformTests, discoverWorkspaceNodeTests, discoverWorkspaceTestSuites } from "./source-test-discovery.mjs";

// Workflow job IDs and published check contexts are contracts. Step display
// names, YAML layout and comments are not. Exercise the actual parsed commands.
const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = name => YAML.parse(readFileSync(path.join(root, ".github", "workflows", name), "utf8"));
const ci = workflow("ci.yml");
const scheduled = workflow("security.yml");
const { workspace, quality, typescript_tests: app, application_build: build, backend: goQuality, postgres, containers, windows, security, required_ci: required, sonar } = ci.jobs;
const audit = scheduled.jobs.javascript;
const goAudit = scheduled.jobs.go;
const owners = ["identity", "dsh", "wlt"];
const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
const expr = body => "$" + "{{ " + body + " }}";
const compact = value => String(value).replace(/\s+/g, "");
const sameExpression = (actual, expected) => assert.equal(compact(actual), compact(expr(expected)));

const steps = job => job.steps ?? [];
const command = step => step.run ?? "";
const commands = job => steps(job).map(command).join("\n");
function one(job, predicate, purpose) {
  const found = steps(job).filter(predicate);
  assert.equal(found.length, 1, "Expected one step: " + purpose);
  return found[0];
}
const runs = (job, pattern) => one(job, step => pattern.test(command(step)), String(pattern));
const action = (step, name) => typeof step.uses === "string" && step.uses.startsWith(name + "@");
function mandatory(_job, step) {
  assert.equal(step.if, undefined, "Required step may not be conditionally skipped");
}
function qualityCheck(step) {
  const install = runs(quality, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.equal(install.id, "dependencies");
  order(quality, install, step);
}
function order(job, ...ordered) {
  const positions = ordered.map(step => steps(job).indexOf(step));
  assert.ok(positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1])), "Incorrect execution order");
}
function invoke(program, args, cwd, env = {}) {
  const result = spawnSync(program, args, { cwd, env: { ...process.env, ...env },
    encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (result.error) throw result.error;
  return result;
}
function shell(script, env = {}, cwd = root) {
  return invoke(bash, ["-c", script], cwd, env);
}

// Workflow syntax belongs to Actionlint. This contract covers the project's
// actual failure propagation, token privileges, and conditional execution.
const independentQualityChecks = [
  /^pnpm check:contracts\s*$/,
  /^pnpm knip:files\s*$/,
  /^pnpm check:design\s*$/,
  /^pnpm check:apps:source\s*$/,
  /^pnpm check:lint --diagnostic-level=warn --max-diagnostics=none\s*$/,
  /^pnpm -r --no-bail --if-present run typecheck\s*$/
];
const afterDependencies = "!cancelled() && steps.dependencies.outcome == 'success'";
const freshCoverage = "steps.coverage.outputs.reuse == 'false'";
const jobConditions = {
  ci: {
    workspace: "github.event_name != 'pull_request' || !startsWith(github.head_ref, 'archive/')",
    sonar: "success() && (github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository)",
    required_ci: "always()"
  },
  security: { dependency_review: "github.event_name == 'pull_request'" }
};
function requireFailurePropagation(item, location) {
  assert.ok(item["continue-on-error"] === undefined || item["continue-on-error"] === false,
    location + ": failure masking is forbidden, including dynamic expressions");
}
function assertWorkflowTrust(document, kind) {
  assert.deepEqual(document.permissions, { contents: "read" }, "Workflow token must remain read-only");
  for (const [id, job] of Object.entries(document.jobs)) {
    const location = kind + "/" + id;
    assert.equal(job.permissions, undefined, location + ": unexpected permission override");
    requireFailurePropagation(job, location);
    const condition = jobConditions[kind][id];
    if (condition === undefined) {
      assert.equal(job.if, undefined, location + ": unexpected job condition");
    } else {
      sameExpression(job.if, condition);
    }
    const admitted = new Map();
    if (kind === "ci" && id === "quality") {
      for (const pattern of independentQualityChecks) admitted.set(runs(job, pattern), afterDependencies);
    }
    if (kind === "ci" && id === "sonar") {
      admitted.set(one(job, step => action(step, "actions/setup-go"), "conditional Go setup"), freshCoverage);
      admitted.set(runs(job, /node tools\/dev\/check-go\.mjs --coverage --sonar-report/), freshCoverage);
    }
    for (const step of steps(job)) {
      const stepLocation = location + "/" + (step.id ?? step.name ?? "unnamed step");
      requireFailurePropagation(step, stepLocation);
      if (admitted.has(step)) sameExpression(step.if, admitted.get(step));
      else assert.equal(step.if, undefined, stepLocation + ": unexpected step condition");
      if (step.uses && !step.uses.startsWith("./")) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (action(step, "actions/checkout")) assert.equal(step.with["persist-credentials"], false);
    }
  }
}

test("all workflow jobs and steps preserve the exact trust and failure contract", () => {
  assertWorkflowTrust(ci, "ci");
  assertWorkflowTrust(scheduled, "security");
});

test("workflow trust rejects failure masking, permission expansion and undeclared skips", () => {
  const rejected = [
    ["ci", copy => { copy.jobs.required_ci["continue-on-error"] = true; }, /failure masking/],
    ["ci", copy => { copy.jobs.required_ci["continue-on-error"] = expr("true"); }, /failure masking/],
    ["ci", copy => { copy.jobs.quality.steps.at(-1)["continue-on-error"] = expr("true"); }, /failure masking/],
    ["security", copy => { copy.jobs.go.steps.at(-1)["continue-on-error"] = true; }, /failure masking/],
    ["ci", copy => { copy.permissions["id-token"] = "write"; }, /read-only/],
    ["security", copy => { copy.jobs.go.permissions = { contents: "write" }; }, /permission override/],
    ["security", copy => { copy.jobs.javascript.if = expr("false"); }, /unexpected job condition/],
    ["ci", copy => { runs(copy.jobs.postgres, /payment-mock\/smoke\.mjs/).if = expr("false"); }, /unexpected step condition/],
    ["ci", copy => { runs(copy.jobs.quality, /^pnpm check:contracts\s*$/).if = expr("false"); }, /Expected values/],
    ["ci", copy => { runs(copy.jobs.sonar, /check-go\.mjs --coverage --sonar-report/).if = undefined; }, /Expected values/]
  ];
  for (const [kind, mutate, expected] of rejected) {
    const copy = structuredClone(kind === "ci" ? ci : scheduled);
    mutate(copy);
    assert.throws(() => assertWorkflowTrust(copy, kind), expected);
  }
});

test("one integration event owner, stable protected names and no duplicate development push", () => {
  assert.deepEqual(ci.on.push, { branches: ["main"] });
  assert.deepEqual(ci.on.pull_request.branches, ["main"]);
  assert.equal(ci.on.pull_request.paths, undefined);
  assert.deepEqual(ci.on.pull_request.types, ["opened", "reopened", "synchronize", "ready_for_review", "converted_to_draft"]);
  assert.deepEqual(Object.keys(scheduled.on).sort(), ["schedule", "workflow_call"]);
  assert.deepEqual(scheduled.on.schedule, [{ cron: "17 3 * * 1" }]);
  assert.deepEqual(Object.keys(scheduled.jobs).sort(), ["dependency_review", "go", "javascript"]);
  assert.deepEqual(Object.keys(ci.jobs).sort(), ["application_build", "backend", "containers", "postgres", "quality", "required_ci", "security", "sonar", "typescript_tests", "windows", "workspace"]);
  assert.deepEqual(readdirSync(path.join(root, ".github/workflows")).filter(name => /\.ya?ml$/i.test(name)).sort(), ["ci.yml", "security.yml"]);
  assert.equal(required.name, "fast-guard");
  assert.equal(sonar.name, "SonarQube Cloud Quality Gate");
  for (const item of Object.values(ci.jobs)) assert.doesNotMatch(item.name ?? "", /\$\{/);
  for (const item of [quality, app, build, goQuality, postgres, containers, windows, security]) {
    assert.equal(item.needs, "workspace");
  }
  assert.equal(security.uses, "./.github/workflows/security.yml");
  assert.deepEqual(new Set(required.needs), new Set(["workspace","quality","typescript_tests","application_build","backend","postgres","containers","windows","security","sonar"]));
  assert.deepEqual(new Set(sonar.needs), new Set(["typescript_tests", "backend", "postgres"]));
  assert.equal(ci.concurrency["cancel-in-progress"], true);
  assert.equal(ci.concurrency.group, "ci-" + expr("github.ref"));
  assert.doesNotMatch(JSON.stringify(ci), /nx affected|DEVELOPMENT_FEEDBACK_ONLY|gh api/);
});

test("required jobs retain the read-only pinned dependency, source, contract, build and owner checks", () => {
  const jobs = [...Object.values(ci.jobs), ...Object.values(scheduled.jobs)];
  for (const job of [quality, app, build, sonar, windows]) {
    const store = one(job, step => step.id === "pnpm-store", "pinned package store");
    const cache = one(job, step => action(step, "actions/cache"), "package-store cache");
    const install = runs(job, /pnpm install --frozen-lockfile --ignore-scripts/);
    mandatory(job, store);
    mandatory(job, cache);
    mandatory(job, install);
    order(job, store, cache, install);
    assert.match(command(store), /pnpm store path --silent/);
    assert.equal(cache.with.path, expr("steps.pnpm-store.outputs.path"));
    assert.match(cache.with.key, /hashFiles\('\.node-version', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches\/\*\*'\)/);
    assert.equal(cache.with["restore-keys"], undefined);
  }
  const lint = runs(workspace, /actionlint_1\.7\.12_linux_amd64\.tar\.gz/);
  mandatory(workspace, lint);
  assert.match(command(lint), /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
  assert.match(command(lint), /sha256sum --check --strict/);
  assert.match(command(lint), /--proto '=https' --proto-redir '=https'/);
  assert.match(command(lint), /"\$dir\/actionlint" -color=false/);
  const install = runs(app, /pnpm install --frozen-lockfile --ignore-scripts/);
  mandatory(app, install);
  assert.doesNotMatch(commands(app), /pnpm audit/);
  assert.equal(audit.needs, undefined);
  // Weekly audit consumes the exact committed lockfile; installation is
  // required by application validation, not by native advisory lookup.
  const checkout = one(audit, step => action(step, "actions/checkout"), "scheduled source checkout");
  const node = one(audit, step => action(step, "actions/setup-node"), "scheduled pinned Node");
  const activate = runs(audit, /corepack enable pnpm/);
  const weeklyScan = runs(audit, /^pnpm audit --audit-level high\s*$/);
  assert.equal(checkout.with["fetch-depth"], 1);
  assert.equal(node.with["node-version-file"], ".node-version");
  assert.equal(node.with["package-manager-cache"], false);
  for (const step of [checkout, node, activate, weeklyScan]) mandatory(audit, step);
  order(audit, checkout, node, activate, weeklyScan);
  assert.equal(steps(audit).length, 4);
  assert.ok(!steps(audit).some(step => action(step, "actions/cache")));
  assert.doesNotMatch(commands(audit), /pnpm install|pnpm store|node --test|check:coverage|--ignore|--fix/);
  const cover = runs(app, /^pnpm check:coverage\s*$/);
  mandatory(app, cover);
  order(app, install, cover);
  assert.doesNotMatch(commands(app), /--check-discovery/);
  const discovered = new Set(discoverWorkspaceNodeTests(root));
  for (const file of ["tools/security/picomatch-redos.test.mjs", "tools/dev/verify-nx-project-graph.test.mjs",
    "tools/mobile/verify-application-boundaries.test.mjs", "tools/dev/check-go.test.mjs"]) {
    assert.ok(discovered.has(file), file);
    assert.ok(!jobs.some(job => commands(job).includes(file)), "Duplicate invocation: " + file);
  }
  // Local and CI consume the same complete owner contract admission command.
  qualityCheck(runs(quality, /^pnpm check:contracts\s*$/));
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.scripts["check:contracts"], "node tools/dev/check-openapi.mjs identity dsh wlt");
  for (const owner of owners) {
    const service = JSON.parse(readFileSync(path.join(root, "services", owner, "package.json"), "utf8"));
    assert.equal(Object.hasOwn(service.scripts, "contract"), false);
  }
  assert.doesNotMatch(readFileSync(path.join(root, "knip.jsonc"), "utf8"), /^\s*"contract",?\s*$/m);
  assert.match(manifest.scripts.check, /pnpm run check:contracts/);
  assert.match(manifest.scripts.check, /--check-discovery/);
  assert.doesNotMatch(manifest.scripts.check, /node --test|check:coverage|check:test-inclusion|check:security/);
  assert.equal(Object.hasOwn(manifest.scripts, "check:apps"), false);
  assert.equal(Object.hasOwn(manifest.scripts, "check:apps:static"), false);
  assert.doesNotMatch(commands(quality), /pnpm --dir services\/\S+ contract|generate-openapi-operations\.mjs --check/);
  for (const pattern of [/pnpm knip:files/, /pnpm check:design/, /pnpm check:apps:source/, /pnpm check:lint/]) {
    qualityCheck(runs(quality, pattern));
  }
  qualityCheck(runs(quality, /pnpm -r --no-bail --if-present run typecheck/));
  for (const pattern of [ /expo export --platform web/,
    /pnpm --dir apps\/control-panel build/, /node tools\/dev\/verify-operator-http.mjs/,
    /node tools\/mobile\/verify-expo-web-http.mjs/]) {
    mandatory(build, runs(build, pattern));
  }
  for (const owner of ["customer", "merchant"]) {
    mandatory(build, runs(build, new RegExp("pnpm --dir apps/" + owner + " exec expo export --platform web")));
  }
  for (const owner of ["customer", "merchant", "captain"]) {
    const android = runs(build, new RegExp("pnpm --dir apps/" + owner + " exec expo export --platform android"));
    mandatory(build, android);
  }
  const http = runs(build, /^node tools\/dev\/run-coverage\.mjs --operator-runtime\s*$/);
  mandatory(build, http);
  order(build, runs(build, /pnpm --dir apps\/control-panel build/), http);
  const suites = discoverWorkspaceTestSuites(root);
  for (const name of ["operator-captain-review-http", "operator-merchant-finance-http", "operator-policy-http",
    "operator-protected-routes", "operator-workspace-http"]) {
    const file = "apps/control-panel/tests/runtime/" + name + ".test.mjs";
    assert.ok(suites.operatorRuntime.includes(file), file);
    assert.ok(!suites.source.includes(file), file);
    assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), /BTHWANI_OPERATOR_HTTP_TEST/);
  }
  assert.deepEqual([...suites.source, ...suites.operatorRuntime].sort(), discoverWorkspaceNodeTests(root));
  mandatory(workspace, runs(workspace, /node tools\/security\/verify-secrets\.mjs/));
  mandatory(goQuality, runs(goQuality, /node tools\/dev\/check-go\.mjs --ci --sonar-report/));
  const outputGate = runs(postgres, /tests\/infra\/test-owner-postgres-output\.sh/);
  const ownerTests = runs(postgres, /tests\/infra\/verify-owner-postgres-ci\.sh/);
  const baselineRestore = runs(postgres, /tests\/infra\/verify-isolated-postgres\.ps1 -DockerContext default/);
  const paymentSmoke = runs(postgres, /tests\/infra\/payment-mock\/smoke\.mjs/);
  assert.equal(command(paymentSmoke), "node tests/infra/payment-mock/smoke.mjs");
  order(postgres, outputGate, ownerTests, baselineRestore, paymentSmoke);
  for (const step of [outputGate, ownerTests, baselineRestore, paymentSmoke]) mandatory(postgres, step);
});

test("Windows acceptance runs the existing admitted platform suites and cannot be skipped by the required gate", () => {
  const step = runs(windows, /^node tools\/dev\/run-coverage\.mjs --windows-platform\s*$/);
  mandatory(windows, step);
  const store = one(windows, item => item.id === "pnpm-store", "Windows package store");
  assert.equal(store.shell, "pwsh");
  assert.match(command(store), /\$PSVersionTable\.PSVersion\.Major -ne 7/);
  order(windows, store, runs(windows, /pnpm install --frozen-lockfile --ignore-scripts/), step);
  const platformFiles = discoverWindowsPlatformTests(root);
  const source = new Set(discoverWorkspaceTestSuites(root).source);
  assert.equal(platformFiles.length, 5);
  assert.ok(platformFiles.every(file => source.has(file)));
  assert.doesNotMatch(commands(app), /--windows-platform/);
  assert.ok(required.needs.includes("windows"));
});

test("required integration gate rejects every failed, cancelled, skipped or missing job", () => {
  const gate = one(required, step => Object.values(step.env ?? {}).some(value => value === expr("needs.typescript_tests.result")), "integration gate");
  mandatory(required, gate);
  const predecessorVariables = required.needs.map(id => {
    const keys = Object.keys(gate.env).filter(key => gate.env[key] === expr("needs." + id + ".result"));
    assert.equal(keys.length, 1);
    return keys[0];
  });
  const good = Object.fromEntries(predecessorVariables.map(key => [key, "success"]));
  assert.equal(shell(command(gate), good).status, 0);
  for (const key of predecessorVariables) for (const value of ["failure", "cancelled", "skipped", ""]) {
    const failed = shell(command(gate), { ...good, [key]: value });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, new RegExp(key));
  }
});

test("coverage producers, quality and build remain independent; Sonar cannot access a token for untrusted or incomplete evidence", () => {
  assert.deepEqual(sonar.needs, ["typescript_tests", "backend", "postgres"]);
  assert.equal(quality.needs, "workspace");
  assert.equal(build.needs, "workspace");
  assert.equal(app.needs, "workspace");
  assert.doesNotMatch(commands(app), /check:lint|typecheck|expo export|operator-runtime/);
  assert.doesNotMatch(commands(quality), /check:coverage|expo export|operator-runtime/);
  assert.doesNotMatch(commands(build), /check:coverage|check:lint/);
  const scanner = one(sonar, step => action(step, "SonarSource/sonarqube-scan-action"), "Sonar scanner");
  mandatory(sonar, scanner);
  assert.equal(scanner.env.SONAR_TOKEN, expr("secrets.SONAR_TOKEN"));
  assert.match(scanner.with.args, /-Dsonar\.qualitygate\.wait=true/);
  assert.ok(required.needs.includes("sonar"));
});

const evidence = [
  { kind: "js", job: app, artifact: "sonar-js", directory: "coverage" },
  { kind: "go", job: goQuality, artifact: "sonar-go", directory: "coverage" },
  { kind: "postgres", job: postgres, artifact: "sonar-postgres", directory: "coverage/owner-postgres" },
];

for (const entry of evidence) {
  test(entry.artifact + " binds the native producer to its artifact and scanner consumer", () => {
    const bind = runs(entry.job, new RegExp("^node tools/dev/ci-coverage-evidence\\.mjs publish " + entry.kind + "\\s*$"));
    const upload = one(entry.job, step => action(step, "actions/upload-artifact") && step.with.name === entry.artifact, entry.artifact);
    const download = one(sonar, step => action(step, "actions/download-artifact") && step.with.name === entry.artifact, entry.artifact);
    mandatory(entry.job, bind);
    mandatory(entry.job, upload);
    order(entry.job, bind, upload);
    if (entry.kind === "postgres") {
      const measure = runs(entry.job, /bash tests\/infra\/verify-owner-postgres-ci\.sh --coverage/);
      mandatory(entry.job, measure);
      order(entry.job, measure, bind);
    }
    assert.equal(upload.with["if-no-files-found"], "error");
    for (const metadata of ["tree.txt", "reports.sha256"]) {
      assert.ok(upload.with.path.split(/\s+/).includes(entry.directory + "/" + metadata));
    }
    assert.equal(download.with.path, expr("runner.temp") + "/" + entry.artifact);
    mandatory(sonar, download);
  });
}

test("Sonar uses the single artifact admission boundary and remeasures only a valid different tree", () => {
  const admit = one(sonar, step => step.id === "coverage", "coverage admission output");
  const fallback = runs(sonar, /node tools\/dev\/check-go\.mjs --coverage --sonar-report/);
  const scanner = one(sonar, step => action(step, "SonarSource/sonarqube-scan-action"), "scanner");
  mandatory(sonar, admit);
  assert.equal(command(admit), "node tools/dev/ci-coverage-evidence.mjs admit");
  sameExpression(admit.env.CI_ANALYSIS_SHA, "github.event.pull_request.head.sha || github.sha");
  assert.match(command(fallback), /pnpm check:coverage/);
  assert.match(command(fallback), /tests\/infra\/test-owner-postgres-output\.sh/);
  sameExpression(fallback.env.CI_ANALYSIS_SHA, "github.event.pull_request.head.sha || github.sha");
  assert.match(command(fallback), /tests\/infra\/verify-owner-postgres-ci\.sh --coverage\s+GITHUB_SHA="\$CI_ANALYSIS_SHA" node tools\/dev\/ci-coverage-evidence\.mjs publish postgres/);
  order(sonar, one(sonar, step => action(step, "actions/setup-node"), "pinned Node"), admit, fallback, scanner);
});

test("Sonar scanner consumes every measured owner report with no quality gate waiver", () => {
  const scanner = one(sonar, step => action(step, "SonarSource/sonarqube-scan-action"), "scanner");
  mandatory(sonar, scanner);
  assert.match(scanner.with.args, /-Dsonar\.qualitygate\.wait=true(?:\s|$)/);
  assert.equal(scanner.env.SONAR_TOKEN, expr("secrets.SONAR_TOKEN"));
  assert.doesNotMatch(JSON.stringify(sonar), /sonar[.]coverage[.]exclusions|Temporary PR 193 coverage exception|Verify the approved coverage exception/);
  const config = readFileSync(path.join(root, "sonar-project.properties"), "utf8");
  const settings = Object.fromEntries(config.split(/\r?\n/).filter(line => line && !line.startsWith("#")).map(line => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.equal(settings["sonar.javascript.lcov.reportPaths"], "coverage/lcov.info");
  assert.deepEqual(settings["sonar.go.coverage.reportPaths"].split(",").sort(),
    ["coverage/dsh-go.out", "coverage/identity-go.out", "coverage/owner-postgres/*.out", "coverage/wlt-go.out"]);
  assert.equal(settings["sonar.coverage.exclusions"], undefined);
  const ownerRunner = readFileSync(path.join(root, "tests/infra/verify-owner-postgres-ci.sh"), "utf8");
  assert.match(ownerRunner, /^ {2}cover_flags=\(-covermode=atomic -coverpkg=\.\/\.\.\.\)$/m,
    "Measure all service packages exercised by isolated PostgreSQL tests");
});

test("Go and container vulnerability checks cover all owners independently", () => {
  const scan = runs(goAudit, /go install golang\.org\/x\/vuln\/cmd\/govulncheck@/);
  const image = runs(containers, /config --format json/);
  mandatory(goAudit, scan);
  mandatory(containers, image);
  assert.equal(containers.needs, "workspace");
  assert.doesNotMatch(commands(goQuality), /govulncheck/);
  assert.equal(scan.env.CGO_ENABLED, "0");
  assert.match(command(scan), /GOSUMDB=sum\.golang\.org go install golang\.org\/x\/vuln\/cmd\/govulncheck@709015412431dd2b5b28a53c06c70bc02d49074c(?:\s|$)/);
  assert.match(command(scan), /set -euo pipefail/);
  assert.match(command(scan), /for service in identity dsh wlt; do/);
  assert.match(command(scan), /cd "services\/\$service\/backend"/);
  assert.match(command(scan), /"\$scanner" \.\/\.\.\./);
  assert.doesNotMatch(command(scan), /\|\|\s*true/);
});

test("image security covers the canonical Compose inventory and fails closed", () => {
  const build = runs(containers, /config --format json/);
  const scan = runs(containers, /trivy_0\.76\.2_Linux-64bit\.tar\.gz/);
  mandatory(containers, build);
  mandatory(containers, scan);
  order(containers, build, scan);
  assert.match(command(build), /--env-file infra\/\.env\.example/);
  assert.match(command(build), /--profile '\*'/);
  assert.match(command(build), /\.services\[\]\.image/);
  assert.match(command(build), /unique/);
  assert.match(command(build), /docker pull "\$image"/);
  assert.match(command(build), /container-scan-inventory\.tsv/);
  assert.match(command(build), /com\.bthwani\.source-sha/);
  assert.match(command(scan), /container-scan-inventory\.tsv/);
  assert.match(command(scan), /bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf/);
  assert.match(command(scan), /sha256sum --check --strict/);
  assert.match(command(scan), /--image-src docker --scanners vuln --severity HIGH,CRITICAL --exit-code 1/);
  assert.match(command(scan), /while IFS=.*read -r image expected/);
  assert.match(command(scan), /docker image inspect/);
  assert.match(command(scan), /\|\| result=1/);
  assert.match(command(scan), /exit "\$result"/);
});

test("container scan loop attempts every image, rejects failures and rejects changed identity", () => {
  const scan = runs(containers, /trivy_0\.76\.2_Linux-64bit\.tar\.gz/);
  const loop = command(scan).slice(command(scan).indexOf("result=0"));
  const id = "sha256:" + "a".repeat(64);
  const fixture = mode => shell([
    "set -euo pipefail",
    "dir=fixture",
    "expected_id=" + id,
    "mode=" + mode,
    "docker() { if [[ \"$mode\" == changed && \"$5\" == second ]]; then printf '%s\\n' invalid; else printf '%s\\n' \"$expected_id\"; fi; }",
    "fixture/trivy() { for last in \"$@\"; do :; done; printf '%s\\n' \"$last\"; [[ \"$mode\" != vulnerable || \"$last\" != first ]]; }",
    mode === "empty" ? "inventory=<(true)" : "inventory=<(printf '%s\\t%s\\n' first \"$expected_id\" second \"$expected_id\")",
    loop
  ].join("\n"));
  const success = fixture("clean");
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(success.stdout.trim().split(/\r?\n/), ["first", "second"]);
  const failed = fixture("vulnerable");
  assert.equal(failed.status, 1, failed.stderr);
  assert.deepEqual(failed.stdout.trim().split(/\r?\n/), ["first", "second"]);
  const changed = fixture("changed");
  assert.equal(changed.status, 1, changed.stderr);
  assert.equal(changed.stdout.trim(), "first");
  assert.equal(fixture("empty").status, 1);
});

test("native dependency review supplements full lockfile and reachable Go audits only on PRs", () => {
  const review = scheduled.jobs.dependency_review;
  const scan = one(review, step => action(step, "actions/dependency-review-action"), "dependency review");
  mandatory(review, scan);
  assert.equal(scan.with["fail-on-severity"], "high");
  assert.equal(security.uses, "./.github/workflows/security.yml");
  assert.ok(required.needs.includes("security"));
});

test("CodeRabbit remains native, incremental and advisory without artificial file exclusions", () => {
  const config = YAML.parse(readFileSync(path.join(root, ".coderabbit.yaml"), "utf8"));
  assert.equal(config.reviews.auto_review.enabled, true);
  assert.equal(config.reviews.auto_review.auto_incremental_review, true);
  assert.equal(config.reviews.auto_review.auto_pause_after_reviewed_commits, 0);
  assert.equal(config.reviews.request_changes_workflow, false);
  assert.equal(config.reviews.path_filters, undefined);
  assert.ok(config.reviews.path_instructions.some(rule => rule.path === ".github/workflows/**"));
  assert.doesNotMatch(JSON.stringify(ci), /coderabbit/i);
});

test("CI uses the supported cache runtime and reports every warning and error without informational log noise", () => {
  for (const job of [quality, app, build, sonar, windows]) {
    const cache = one(job, step => action(step, "actions/cache"), "pinned package store cache");
    assert.equal(cache.uses, "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9");
  }
  const lint = runs(quality, /^pnpm check:lint --diagnostic-level=warn --max-diagnostics=none\s*$/);
  qualityCheck(lint);
  const config = JSON.parse(readFileSync(path.join(root, "biome.json"), "utf8"));
  assert.ok(config.files.includes.every(pattern => !(pattern.startsWith("!!") && pattern.endsWith("/**"))));
  assert.equal(config.linter.enabled, true);
  assert.equal(config.linter.rules.preset, "recommended");
});
