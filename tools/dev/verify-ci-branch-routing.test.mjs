import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { discoverWorkspaceNodeTests } from "./source-test-discovery.mjs";

// Workflow job IDs and published check contexts are contracts. Step display
// names, YAML layout and comments are not. Exercise the actual parsed commands.
const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = name => YAML.parse(readFileSync(path.join(root, ".github", "workflows", name), "utf8"));
const ci = workflow("ci.yml");
const go = workflow("go-quality.yml");
const { workspace_validation: workspace, application_quality: app, development_feedback: feedback,
  dependency_security: audit, backend_quality: backend, required_ci: required, sonar } = ci.jobs;
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
const portable = file => file.replaceAll("\\", "/");
function git(cwd, ...args) {
  const result = invoke("git", ["-c", "commit.gpgsign=false", "-c", "user.name=CI fixture",
    "-c", "user.email=ci@example.invalid", "-c", "core.hooksPath=" + path.join(cwd, "no-hooks"), ...args], cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function candidate(directory) {
  git(directory, "init", "--quiet");
  put(directory, "source.txt", "original\n");
  git(directory, "add", "--", "source.txt");
  git(directory, "commit", "--quiet", "-m", "synthetic CI candidate");
  return { sha: git(directory, "rev-parse", "HEAD"), tree: git(directory, "rev-parse", "HEAD^{tree}") };
}
const full = "github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main')";
const publish = "github.event_name == 'pull_request' || (github.event_name == 'push' && github.ref == 'refs/heads/main')";

test("canonical event topology retains protected checks and independent periodic audit", () => {
  assert.deepEqual(ci.on.push.branches, ["**", "!archive/**"]);
  assert.deepEqual(ci.on.pull_request.branches, ["main"]);
  assert.equal(ci.on.push.paths, undefined);
  assert.equal(ci.on.pull_request.paths, undefined);
  assert.ok(Object.hasOwn(ci.on, "workflow_dispatch"));
  assert.deepEqual(ci.on.schedule, [{ cron: "17 3 * * 1" }]);
  assert.deepEqual(Object.keys(go.on), ["workflow_call"]);
  for (const obsolete of ["dependency-nx-safety.yml", "sonar-quality.yml"]) {
    assert.ok(!existsSync(path.join(root, ".github/workflows", obsolete)));
  }
  sameExpression(app.if, full);
  sameExpression(backend.if, full);
  sameExpression(audit.if, "github.event_name == 'schedule'");
  sameExpression(feedback.if, "github.event_name == 'push' && github.ref != 'refs/heads/main'");
  sameExpression(required.if, "!cancelled() && (" + full + ")");
  sameExpression(sonar.if, "!cancelled() && (" + publish + ")");
  sameExpression(required.name, "github.event_name == 'pull_request' && 'fast-guard' || 'full-ci'");
  sameExpression(sonar.name, "github.event_name == 'pull_request' && 'SonarQube Cloud Quality Gate' || 'SonarQube main analysis'");
  assert.equal(backend.uses, "./.github/workflows/go-quality.yml");
  assert.deepEqual(new Set(required.needs), new Set(["workspace_validation", "application_quality", "backend_quality"]));
  assert.deepEqual(new Set(sonar.needs), new Set(["application_quality", "backend_quality"]));
  assert.equal(ci.concurrency["cancel-in-progress"], true);
  assert.match(ci.concurrency.group, /github\.ref/);
  assert.match(ci.concurrency.group, /github\.event_name/);
  assert.match(ci.concurrency.group, /github\.sha/);
});

test("required jobs retain the read-only pinned dependency, source, contract, build and owner checks", () => {
  const jobs = [...Object.values(ci.jobs), ...Object.values(go.jobs)];
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
  for (const owner of owners) assert.ok(commands(app).includes("pnpm --dir services/" + owner + " contract"));
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
  const http = one(app, step => step.env?.BTHWANI_OPERATOR_HTTP_TEST === "1", "real Operator HTTP tests");
  mandatory(app, http);
  order(app, runs(app, /pnpm --dir apps\/control-panel build/), http);
  assert.match(command(http), /apps\/control-panel\/tests\/operator-\*-http\.test\.mjs/);
  assert.match(command(http), /apps\/control-panel\/tests\/operator-protected-routes\.test\.mjs/);
  mandatory(workspace, runs(workspace, /node tools\/security\/verify-secrets\.mjs/));
  mandatory(goQuality, runs(goQuality, /node tools\/dev\/check-go\.mjs --ci --sonar-report/));
  mandatory(postgres, runs(postgres, /tests\/infra\/verify-owner-postgres-ci\.sh/));
  mandatory(postgres, runs(postgres, /tests\/infra\/verify-isolated-postgres\.ps1 -DockerContext default/));
});

test("native Nx selects affected tasks or a full fallback without running merge-only suites", () => {
  const step = runs(feedback, /pnpm exec nx affected/);
  mandatory(feedback, step);
  const renamed = { ...feedback, steps: steps(feedback).map(item => ({ ...item, name: "arbitrary display label" })) };
  assert.equal(command(runs(renamed, /pnpm exec nx affected/)), command(step));
  const stub = 'git() { test "$ANCESTOR" = yes; }\npnpm() { printf "%s\\n" "$*"; }\n';
  for (const [before, ancestor, expected] of [["a".repeat(40), "yes", "affected"], ["000", "yes", "run-many"], ["a".repeat(40), "no", "run-many"]]) {
    const result = shell(stub + command(step), { BEFORE_SHA: before, GITHUB_SHA: "b".repeat(40), ANCESTOR: ancestor });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp("nx " + expected + " -t typecheck,test"));
    assert.match(result.stdout, /--skip-nx-cache/);
  }
  assert.doesNotMatch(commands(feedback), /check:coverage|expo export|verify-owner-postgres-ci/);
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
  check(0, { CI_EVENT: "workflow_dispatch", CI_REF: "refs/heads/feature" });
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
  { job: app, artifact: "sonar-js", paths: ["coverage/lcov.info"], stamp: "coverage/tree.txt" },
  { job: goQuality, artifact: "sonar-go", paths: owners.map(owner => "coverage/" + owner + "-go.out"), stamp: "coverage/tree.txt" },
  { job: postgres, artifact: "sonar-postgres", paths: ["coverage/owner-postgres/profile.out"], stamp: "coverage/owner-postgres/tree.txt" },
];
for (const entry of evidence) {
  test(entry.artifact + " producer binds evidence to real clean Git tree and uploads it without masking errors", () => fixture("ci-coverage-producer-", directory => {
    const bind = runs(entry.job, /git rev-parse 'HEAD\^\{tree\}'/);
    const upload = one(entry.job, step => action(step, "actions/upload-artifact") && step.with.name === entry.artifact, entry.artifact);
    const download = one(sonar, step => action(step, "actions/download-artifact") && step.with.name === entry.artifact, entry.artifact);
    sameExpression(bind.if, publish);
    sameExpression(upload.if, publish);
    order(entry.job, bind, upload);
    assert.equal(upload.with["if-no-files-found"], "error");
    assert.ok(upload.with.path.split(/\s+/).includes(entry.stamp));
    assert.equal(download.with.path, expr("runner.temp") + "/" + entry.artifact);
    mandatory(sonar, download);
    const { sha, tree } = candidate(directory);
    for (const file of entry.paths) put(directory, file);
    const valid = shell(command(bind), { GITHUB_SHA: sha }, directory);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(readFileSync(path.join(directory, entry.stamp), "utf8").trim(), tree);
    assert.notEqual(shell(command(bind), { GITHUB_SHA: "0".repeat(40) }, directory).status, 0);
    put(directory, "source.txt", "dirty\n");
    assert.notEqual(shell(command(bind), { GITHUB_SHA: sha }, directory).status, 0);
  }));
}

test("Sonar reuses only complete matching real Git trees and remeasures legitimate differences", () => {
  const admit = one(sonar, step => step.id === "coverage", "coverage admission output");
  const fallback = runs(sonar, /node tools\/dev\/check-go\.mjs --coverage --sonar-report/);
  mandatory(sonar, admit);
  sameExpression(fallback.if, "steps.coverage.outputs.reuse == 'false'");
  assert.match(command(fallback), /pnpm check:coverage/);
  assert.match(command(fallback), /tests\/infra\/test-owner-postgres-output\.sh/);
  assert.match(command(fallback), /tests\/infra\/verify-owner-postgres-ci\.sh --coverage/);
  order(sonar, admit, fallback, one(sonar, step => action(step, "SonarSource/sonarqube-scan-action"), "scanner"));
  const profiles = [["sonar-js", "lcov.info"], ...owners.map(owner => ["sonar-go", owner + "-go.out"]), ["sonar-postgres", "profile.out"]];
  const scenarios = [
    { name: "matching", expected: "reuse=true" },
    { name: "different valid tree", alternate: true, expected: "reuse=false" },
    { name: "mixed producer trees", mixed: true },
    { name: "invalid tree", invalid: true },
    { name: "missing stamp", omit: "sonar-go/tree.txt" },
    { name: "missing Go report", omit: "sonar-go/dsh-go.out" },
    { name: "missing PostgreSQL profile", omit: "sonar-postgres/profile.out" },
    { name: "empty JS report", empty: "sonar-js/lcov.info" },
    { name: "empty PostgreSQL profile", empty: "sonar-postgres/profile.out" },
  ];
  for (const scenario of scenarios) fixture("ci-sonar-admission-", directory => {
    const { tree } = candidate(directory);
    const reports = path.join(directory, "reports");
    put(directory, "source.txt", "alternate source\n");
    git(directory, "add", "--", "source.txt");
    const different = git(directory, "write-tree");
    git(directory, "restore", "--staged", "--worktree", "--", "source.txt");
    assert.notEqual(tree, different);
    for (const { artifact } of evidence) {
      const relative = artifact + "/tree.txt";
      const value = scenario.invalid ? "invalid-tree" : scenario.alternate || (scenario.mixed && artifact === "sonar-postgres") ? different : tree;
      if (relative !== scenario.omit) put(reports, relative, value + "\n");
    }
    for (const [artifact, file] of profiles) {
      const relative = artifact + "/" + file;
      if (relative !== scenario.omit) put(reports, relative, relative === scenario.empty ? "" : "synthetic report\n");
    }
    const output = path.join(directory, "output.txt");
    const result = shell(command(admit), { RUNNER_TEMP: portable(reports), GITHUB_OUTPUT: portable(output) }, directory);
    assert.equal(result.status, scenario.expected ? 0 : 1, scenario.name + ": " + result.stderr);
    if (scenario.expected) assert.equal(readFileSync(output, "utf8").trim(), scenario.expected);
    else assert.ok(!existsSync(output), scenario.name);
    for (const entry of evidence) for (const report of entry.paths) {
      assert.equal(existsSync(path.join(directory, report)), scenario.expected === "reuse=true", scenario.name);
    }
  });
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
