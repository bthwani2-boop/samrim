import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { admitCoverageEvidence, publishCoverageEvidence } from "./ci-coverage-evidence.mjs";
import { discoverWindowsPlatformTests, discoverWorkspaceNodeTests, discoverWorkspaceTestSuites } from "./source-test-discovery.mjs";

// Workflow job IDs and published check contexts are contracts. Step display
// names, YAML layout and comments are not. Exercise the actual parsed commands.
const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = name => YAML.parse(readFileSync(path.join(root, ".github", "workflows", name), "utf8"));
const ci = workflow("ci.yml");
const go = workflow("go-quality.yml");
const scheduled = workflow("dependency-audit.yml");
const { workspace_validation: workspace, application_quality: app,
  backend_quality: backend, windows_platform: windows, required_ci: required, sonar } = ci.jobs;
const audit = scheduled.jobs.dependency_security;
const goQuality = go.jobs["go-quality"];
const postgres = go.jobs["owner-postgres-integration"];
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
function mandatory(job, step) {
  assert.equal(step.if, undefined, "Required step may not be conditionally skipped");
  assert.notEqual(step["continue-on-error"], true);
  assert.notEqual(job["continue-on-error"], true);
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
function fixture(prefix, fn) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  try { return fn(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
function put(directory, relative, text = "synthetic coverage fixture\n") {
  const file = path.join(directory, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  return file;
}

function git(cwd, ...args) {
  const result = invoke("git", ["-c", "commit.gpgsign=false", "-c", "user.name=CI fixture",
    "-c", "user.email=ci@example.invalid", "-c", "core.hooksPath=" + path.join(cwd, "no-hooks"), ...args], cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function candidate(directory) {
  git(directory, "init", "--quiet");
  git(directory, "config", "core.autocrlf", "false");
  put(directory, ".gitattributes", "* text=auto eol=lf\n");
  put(directory, "source.txt", "original\n");
  put(directory, ".gitignore", "coverage/\n");
  git(directory, "add", "--", "source.txt", ".gitignore", ".gitattributes");
  git(directory, "commit", "--quiet", "-m", "synthetic CI candidate");
  return { sha: git(directory, "rev-parse", "HEAD"), tree: git(directory, "rev-parse", "HEAD^{tree}") };
}
test("native events admit only PR updates and integrated main pushes; periodic audit owns its own event", () => {
  assert.deepEqual(Object.keys(ci.on).sort(), ["pull_request", "push"]);
  assert.deepEqual(ci.on.push, { branches: ["main"] });
  assert.deepEqual(ci.on.pull_request.branches, ["main"]);
  assert.deepEqual(ci.on.pull_request.types, ["opened", "reopened", "synchronize", "ready_for_review", "converted_to_draft"]);
  assert.equal(ci.on.pull_request.paths, undefined);
  assert.deepEqual(Object.keys(scheduled.on), ["schedule"]);
  assert.deepEqual(scheduled.on.schedule, [{ cron: "17 3 * * 1" }]);
  assert.deepEqual(Object.keys(scheduled.jobs), ["dependency_security"]);
  assert.deepEqual(Object.keys(go.on), ["workflow_call"]);
  assert.deepEqual(Object.keys(ci.jobs).sort(), [
    "application_quality", "backend_quality", "required_ci", "sonar", "windows_platform", "workspace_validation",
  ]);
  for (const obsolete of ["dependency-nx-safety.yml", "sonar-quality.yml"]) {
    assert.ok(!existsSync(path.join(root, ".github/workflows", obsolete)));
  }
  for (const job of [workspace, app, backend, windows, audit]) assert.equal(job.if, undefined);
  assert.equal(workspace.needs, undefined);
  assert.equal(app.needs, "workspace_validation");
  assert.equal(windows.needs, "workspace_validation");
  assert.equal(windows["runs-on"], "windows-2025");
  assert.equal(backend.needs, "workspace_validation");
  sameExpression(required.if, "!cancelled()");
  sameExpression(sonar.if, "!cancelled()");
  assert.equal(required.name, "fast-guard");
  assert.equal(sonar.name, "SonarQube Cloud Quality Gate");
  assert.equal(backend.uses, "./.github/workflows/go-quality.yml");
  assert.deepEqual(new Set(required.needs), new Set(["workspace_validation", "application_quality", "backend_quality", "windows_platform"]));
  assert.deepEqual(new Set(sonar.needs), new Set(["application_quality", "backend_quality"]));
  assert.equal(ci.concurrency["cancel-in-progress"], true);
  assert.equal(ci.concurrency.group, "ci-" + expr("github.ref"));
  for (const parsed of [ci, go, scheduled]) {
    for (const job of Object.values(parsed.jobs)) {
      assert.doesNotMatch(commands(job), /gh api|nx affected|nx run-many|VERIFICATION_OWNER/);
    }
  }
});

test("required jobs retain the read-only pinned dependency, source, contract, build and owner checks", () => {
  const jobs = [...Object.values(ci.jobs), ...Object.values(go.jobs), audit];
  for (const job of jobs) {
    assert.notEqual(job["continue-on-error"], true);
    for (const step of steps(job)) {
      assert.notEqual(step["continue-on-error"], true);
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (action(step, "actions/checkout")) assert.equal(step.with["persist-credentials"], false);
    }
  }
  assert.equal(ci.permissions.contents, "read");
  assert.equal(go.permissions.contents, "read");
  assert.equal(scheduled.permissions.contents, "read");
  for (const job of [app, audit, sonar, windows]) {
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
  for (const job of [app, audit]) {
    const install = runs(job, /pnpm install --frozen-lockfile --ignore-scripts/);
    const scan = runs(job, /^pnpm audit --audit-level high\s*$/);
    mandatory(job, install);
    mandatory(job, scan);
    order(job, install, scan);
  }
  assert.equal(audit.needs, undefined);
  assert.doesNotMatch(commands(audit), /node --test|check:coverage/);
  const cover = runs(app, /^pnpm check:coverage\s*$/);
  mandatory(app, cover);
  order(app, runs(app, /^pnpm audit --audit-level high\s*$/), cover);
  assert.doesNotMatch(commands(app), /--check-discovery/);
  const discovered = new Set(discoverWorkspaceNodeTests(root));
  for (const file of ["tools/security/picomatch-redos.test.mjs", "tools/dev/verify-nx-project-graph.test.mjs",
    "tools/mobile/verify-application-boundaries.test.mjs", "tools/dev/check-go.test.mjs"]) {
    assert.ok(discovered.has(file), file);
    assert.ok(!jobs.some(job => commands(job).includes(file)), "Duplicate invocation: " + file);
  }
  // Local and CI consume the same complete owner contract admission command.
  mandatory(app, runs(app, /^pnpm check:contracts\s*$/));
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.scripts["check:contracts"], "node tools/dev/check-openapi.mjs identity dsh wlt");
  assert.match(manifest.scripts.check, /pnpm run check:contracts/);
  assert.match(manifest.scripts.check, /--check-discovery/);
  assert.doesNotMatch(manifest.scripts.check, /node --test|check:coverage|check:test-inclusion|check:security/);
  assert.equal(Object.hasOwn(manifest.scripts, "check:apps"), false);
  assert.equal(Object.hasOwn(manifest.scripts, "check:apps:static"), false);
  assert.doesNotMatch(commands(app), /pnpm --dir services\/\S+ contract|generate-openapi-operations\.mjs --check/);
  for (const pattern of [/pnpm knip:files/, /pnpm check:design/, /pnpm check:apps:source/,
    /pnpm -r --if-present run typecheck/, /expo export --platform web/,
    /pnpm --dir apps\/control-panel build/, /node tools\/dev\/verify-operator-http.mjs/,
    /node tools\/mobile\/verify-expo-web-http.mjs/]) {
    mandatory(app, runs(app, pattern));
  }
  for (const owner of ["customer", "merchant"]) {
    mandatory(app, runs(app, new RegExp("pnpm --dir apps/" + owner + " exec expo export --platform web")));
  }
  for (const owner of ["customer", "merchant", "captain"]) {
    const android = runs(app, new RegExp("pnpm --dir apps/" + owner + " exec expo export --platform android"));
    mandatory(app, android);
  }
  const http = runs(app, /^node tools\/dev\/run-coverage\.mjs --operator-runtime\s*$/);
  mandatory(app, http);
  order(app, runs(app, /pnpm --dir apps\/control-panel build/), http);
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
  mandatory(postgres, runs(postgres, /tests\/infra\/verify-owner-postgres-ci\.sh/));
  mandatory(postgres, runs(postgres, /tests\/infra\/verify-isolated-postgres\.ps1 -DockerContext default/));
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
  assert.ok(required.needs.includes("windows_platform"));
});

test("merge gate executes fail closed for every predecessor, incorrect event and archive ref", () => {
  const gate = one(required, step => Object.values(step.env ?? {}).some(value => value === expr("needs.application_quality.result")), "required predecessor gate");
  mandatory(required, gate);
  const predecessorVariables = required.needs.map(id => {
    const keys = Object.keys(gate.env).filter(key => gate.env[key] === expr("needs." + id + ".result"));
    assert.equal(keys.length, 1);
    return keys[0];
  });
  const good = { HEAD_REF: "feature", CI_EVENT: "pull_request", CI_REF: "refs/pull/195/merge",
    ...Object.fromEntries(predecessorVariables.map(key => [key, "success"])) };
  const check = (expected, overrides = {}) => assert.equal(shell(command(gate), { ...good, ...overrides }).status, expected);
  check(0);
  for (const key of predecessorVariables) for (const value of ["failure", "cancelled", "skipped", ""]) check(1, { [key]: value });
  check(0, { CI_EVENT: "push", CI_REF: "refs/heads/main" });
  check(1, { CI_EVENT: "workflow_dispatch", CI_REF: "refs/heads/feature" });
  check(1, { CI_EVENT: "push", CI_REF: "refs/heads/feature" });
  check(1, { CI_EVENT: "schedule" });
  check(1, { HEAD_REF: "archive/old" });
  check(1, { CI_EVENT: "workflow_dispatch", CI_REF: "refs/heads/archive/old" });
});

test("Sonar rejects untrusted source or failed producers before accessing the scanner secret", () => {
  const gate = one(sonar, step => Object.hasOwn(step.env ?? {}, "TRUSTED_SOURCE"), "Sonar trust gate");
  const scanner = one(sonar, step => action(step, "SonarSource/sonarqube-scan-action"), "Sonar quality scanner");
  mandatory(sonar, gate);
  mandatory(sonar, scanner);
  order(sonar, gate, scanner);
  assert.equal(scanner.env.SONAR_TOKEN, expr("secrets.SONAR_TOKEN"));
  assert.match(scanner.with.args, /-Dsonar\.qualitygate\.wait=true/);
  sameExpression(gate.env.TRUSTED_SOURCE, "github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository");
  sameExpression(gate.env.PRESENTATION_RESULT, "needs.application_quality.result");
  sameExpression(gate.env.GO_RESULT, "needs.backend_quality.result");
  const good = { TRUSTED_SOURCE: "true", PRESENTATION_RESULT: "success", GO_RESULT: "success" };
  assert.equal(shell(command(gate), good).status, 0);
  for (const [key, values] of [["TRUSTED_SOURCE", ["false", ""]], ["PRESENTATION_RESULT", ["failure", "skipped", "cancelled", ""]], ["GO_RESULT", ["failure", "skipped", "cancelled", ""]]]) {
    for (const value of values) assert.equal(shell(command(gate), { ...good, [key]: value }).status, 1);
  }
});

const evidence = [
  { kind: "js", job: app, artifact: "sonar-js", directory: "coverage", files: ["lcov.info"] },
  { kind: "go", job: goQuality, artifact: "sonar-go", directory: "coverage", files: owners.map(owner => owner + "-go.out").sort() },
  { kind: "postgres", job: postgres, artifact: "sonar-postgres", directory: "coverage/owner-postgres", files: ["identity-session.test-1.out", "wlt-wallet.test-2.out"] },
];

function independentManifest(directory, names) {
  const result = shell("LC_ALL=C sha256sum --binary -- " + names.join(" "), {}, directory);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replaceAll("\r\n", "\n");
}

for (const entry of evidence) {
  test(entry.artifact + " attests every measured report to the exact clean committed source", () => fixture("ci-coverage-producer-", directory => {
    const bind = runs(entry.job, new RegExp("^node tools/dev/ci-coverage-evidence\\.mjs publish " + entry.kind + "\\s*$"));
    const upload = one(entry.job, step => action(step, "actions/upload-artifact") && step.with.name === entry.artifact, entry.artifact);
    const download = one(sonar, step => action(step, "actions/download-artifact") && step.with.name === entry.artifact, entry.artifact);
    mandatory(entry.job, bind);
    mandatory(entry.job, upload);
    order(entry.job, bind, upload);
    assert.equal(upload.with["if-no-files-found"], "error");
    for (const metadata of ["tree.txt", "reports.sha256"]) {
      assert.ok(upload.with.path.split(/\s+/).includes(entry.directory + "/" + metadata));
    }
    assert.equal(download.with.path, expr("runner.temp") + "/" + entry.artifact);
    mandatory(sonar, download);
    const { sha, tree } = candidate(directory);
    const folder = path.join(directory, entry.directory);
    for (const file of entry.files) put(directory, entry.directory + "/" + file);
    const result = publishCoverageEvidence(directory, entry.kind, sha);
    assert.deepEqual(result, { tree, count: entry.files.length });
    assert.equal(readFileSync(path.join(folder, "tree.txt"), "utf8").trim(), tree);
    assert.equal(readFileSync(path.join(folder, "reports.sha256"), "utf8"), independentManifest(folder, entry.files));
    assert.throws(() => publishCoverageEvidence(directory, entry.kind, sha), /CI_COVERAGE_METADATA_CONFLICT/);
    for (const metadata of ["tree.txt", "reports.sha256"]) rmSync(path.join(folder, metadata));
    assert.throws(() => publishCoverageEvidence(directory, entry.kind, "0".repeat(40)), /CI_CANDIDATE_SHA_MISMATCH/);
    const reject = () => assert.throws(() => publishCoverageEvidence(directory, entry.kind, sha), /CI_CANDIDATE_NOT_CLEAN_AND_ADMITTED/);
    const untracked = put(directory, "untracked-source.test.mjs");
    reject();
    git(directory, "add", "--", "untracked-source.test.mjs");
    reject();
    git(directory, "rm", "--cached", "--", "untracked-source.test.mjs");
    rmSync(untracked);
    put(directory, "source.txt", "dirty\n");
    reject();
    git(directory, "add", "--", "source.txt");
    put(directory, "source.txt", "original\n");
    reject();
    git(directory, "restore", "--staged", "--worktree", "--", "source.txt");
    // Git's stat cache can deliberately hide working-tree changes. The
    // attestation must compare actual bytes to the committed object instead.
    for (const flag of ["assume-unchanged", "skip-worktree"]) {
      git(directory, "update-index", "--" + flag, "--", "source.txt");
      put(directory, "source.txt", "hidden source\n");
      assert.equal(git(directory, "status", "--porcelain", "--", "source.txt"), "");
      reject();
      put(directory, "source.txt", "original\n");
      git(directory, "update-index", "--no-" + flag, "--", "source.txt");
      git(directory, "restore", "--worktree", "--", "source.txt");
      assert.equal(git(directory, "status", "--porcelain"), "", "fixture restored its actual committed source");
    }
    put(directory, entry.directory + "/" + entry.files[0], "");
    assert.throws(() => publishCoverageEvidence(directory, entry.kind, sha), /CI_COVERAGE_REPORT_EMPTY/);
    assert.ok(!existsSync(path.join(folder, "tree.txt")));
  }));
}

test("Sonar uses the single artifact admission boundary and remeasures only a valid different tree", () => {
  const admit = one(sonar, step => step.id === "coverage", "coverage admission output");
  const fallback = runs(sonar, /node tools\/dev\/check-go\.mjs --coverage --sonar-report/);
  const scanner = one(sonar, step => action(step, "SonarSource/sonarqube-scan-action"), "scanner");
  mandatory(sonar, admit);
  assert.equal(command(admit), "node tools/dev/ci-coverage-evidence.mjs admit");
  sameExpression(admit.env.CI_ANALYSIS_SHA, "github.event.pull_request.head.sha || github.sha");
  sameExpression(fallback.if, "steps.coverage.outputs.reuse == 'false'");
  sameExpression(one(sonar, step => action(step, "actions/setup-go"), "Go fallback setup").if, "steps.coverage.outputs.reuse == 'false'");
  assert.match(command(fallback), /pnpm check:coverage/);
  assert.match(command(fallback), /tests\/infra\/test-owner-postgres-output\.sh/);
  assert.match(command(fallback), /tests\/infra\/verify-owner-postgres-ci\.sh --coverage/);
  order(sonar, one(sonar, step => action(step, "actions/setup-node"), "pinned Node"), admit, fallback, scanner);

  const firstProfile = "sonar-postgres/" + evidence[2].files[0];
  const scenarios = [
    { name: "matching", expected: true },
    { name: "different valid tree", alternate: true, expected: false },
    { name: "mixed producer trees", mixed: true },
    { name: "invalid tree", invalid: true },
    { name: "missing stamp", omit: "sonar-go/tree.txt" },
    { name: "missing Go report", omit: "sonar-go/dsh-go.out" },
    { name: "missing PostgreSQL profile", omit: firstProfile },
    { name: "missing PostgreSQL manifest", omit: "sonar-postgres/reports.sha256" },
    { name: "altered JS report", alter: "sonar-js/lcov.info" },
    { name: "altered Go report", alter: "sonar-go/identity-go.out" },
    { name: "altered PostgreSQL profile", alter: firstProfile },
    { name: "unexpected extra PostgreSQL profile", extra: "sonar-postgres/unexpected.out" },
    { name: "unexpected extra Go report", extra: "sonar-go/extra.out" },
    { name: "empty JS report", empty: "sonar-js/lcov.info" },
    { name: "empty PostgreSQL profile", empty: firstProfile },
    { name: "dirty analysis candidate", dirty: true },
    { name: "hidden analysis source edit", hidden: true },
    { name: "wrong analysis SHA", wrongSha: true },
  ];
  for (const scenario of scenarios) fixture("ci-sonar-admission-", directory => {
    const repo = path.join(directory, "repo");
    mkdirSync(repo);
    const { sha, tree } = candidate(repo);
    const downloaded = path.join(directory, "reports");
    put(repo, "source.txt", "alternate source\n");
    git(repo, "add", "--", "source.txt");
    const different = git(repo, "write-tree");
    git(repo, "restore", "--staged", "--worktree", "--", "source.txt");
    assert.notEqual(tree, different);
    for (const entry of evidence) {
      const value = scenario.invalid ? "invalid-tree" : scenario.alternate || (scenario.mixed && entry.kind === "postgres") ? different : tree;
      put(downloaded, entry.artifact + "/tree.txt", value + "\n");
      for (const file of entry.files) put(downloaded, entry.artifact + "/" + file, "synthetic report\n");
      put(downloaded, entry.artifact + "/reports.sha256", independentManifest(path.join(downloaded, entry.artifact), entry.files));
    }
    if (scenario.omit) rmSync(path.join(downloaded, scenario.omit));
    if (scenario.empty) put(downloaded, scenario.empty, "");
    if (scenario.alter) put(downloaded, scenario.alter, "changed report\n");
    if (scenario.extra) put(downloaded, scenario.extra, "extra report\n");
    if (scenario.dirty) put(repo, "untracked.mjs", "export {};\n");
    if (scenario.hidden) {
      git(repo, "update-index", "--assume-unchanged", "--", "source.txt");
      put(repo, "source.txt", "hidden changed source\n");
      assert.equal(git(repo, "status", "--porcelain", "--", "source.txt"), "");
    }
    const run = () => admitCoverageEvidence(repo, downloaded, scenario.wrongSha ? "0".repeat(40) : sha);
    if (Object.hasOwn(scenario, "expected")) assert.equal(run(), scenario.expected, scenario.name);
    else assert.throws(run, undefined, scenario.name);
    for (const entry of evidence) for (const report of entry.files) {
      const installed = path.join(repo, entry.directory, report);
      assert.equal(existsSync(installed), scenario.expected === true, scenario.name);
      if (scenario.expected === true) assert.deepEqual(readFileSync(installed), readFileSync(path.join(downloaded, entry.artifact, report)));
    }
  });
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
  assert.match(ownerRunner, /^  cover_flags=\(-covermode=atomic -coverpkg=\.\/\.\.\.\)$/m,
    "Measure all service packages exercised by isolated PostgreSQL tests");
});

test("Go vulnerability gate is pinned, scans all deployed owners and precedes image creation", () => {
  const scan = runs(goQuality, /go install golang\.org\/x\/vuln\/cmd\/govulncheck@/);
  const image = runs(goQuality, /docker build --file/);
  mandatory(goQuality, scan);
  order(goQuality, scan, image);
  assert.equal(scan.env.CGO_ENABLED, "0");
  assert.match(command(scan), /GOSUMDB=sum\.golang\.org go install golang\.org\/x\/vuln\/cmd\/govulncheck@709015412431dd2b5b28a53c06c70bc02d49074c(?:\s|$)/);
  assert.match(command(scan), /set -euo pipefail/);
  assert.match(command(scan), /for service in identity dsh wlt; do/);
  assert.match(command(scan), /cd "services\/\$service\/backend"/);
  assert.match(command(scan), /"\$scanner" \.\/\.\.\./);
  assert.doesNotMatch(command(scan), /\|\|\s*true/);
});
