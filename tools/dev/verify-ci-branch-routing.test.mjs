import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { discoverWorkspaceNodeTests } from "./source-test-discovery.mjs";

const root = new URL("../../", import.meta.url);
const ciText = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
const goText = readFileSync(new URL(".github/workflows/go-quality.yml", root), "utf8");
const ci = YAML.parse(ciText);
const go = YAML.parse(goText);
const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
const app = ci.jobs.application_quality;
const backend = ci.jobs.backend_quality;
const dependency = ci.jobs.dependency_security;
const required = ci.jobs.required_ci;
const feedback = ci.jobs.development_feedback;
const sonar = ci.jobs.sonar;
const event = (name) => ci.on[name];
test("one event owner admits future branches, archives are excluded and scheduled audit is retained", () => {
  assert.deepEqual(event("push").branches, ["**", "!archive/**"]);
  assert.deepEqual(event("pull_request").branches, ["main"]);
  assert.equal(event("push").paths, undefined);
  assert.equal(event("pull_request").paths, undefined);
  assert.ok(Object.hasOwn(ci.on, "workflow_dispatch"));
  assert.deepEqual(event("schedule"), [{ cron: "17 3 * * 1" }]);
  assert.deepEqual(Object.keys(go.on), ["workflow_call"]);
  assert.equal(existsSync(new URL(".github/workflows/dependency-nx-safety.yml", root)), false);
  assert.equal(existsSync(new URL(".github/workflows/sonar-quality.yml", root)), false);
});

test("full candidate and development feedback have disjoint routing and protected contexts", () => {
  const full = "${{ github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main') }}";
  assert.equal(app.if, full);
  assert.equal(backend.if, full);
  assert.equal(dependency.if, "${{ github.event_name == 'schedule' || github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main') }}");
  assert.equal(feedback.if, "${{ github.event_name == 'push' && github.ref != 'refs/heads/main' }}");
  assert.deepEqual(required.needs, ["workspace_validation", "application_quality", "dependency_security", "backend_quality"]);
  assert.equal(required.name, "${{ github.event_name == 'pull_request' && 'fast-guard' || 'full-ci' }}");
  assert.equal(required.if, "${{ !cancelled() && (github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main')) }}");
  assert.equal(backend.uses, "./.github/workflows/go-quality.yml");
  assert.equal(ci.concurrency["cancel-in-progress"], true);
  assert.ok(ci.concurrency.group.includes("format('manual-{0}', github.sha)"));
});

test("full CI executes discovered source tests once and keeps real owner, build and security checks", () => {
  const discovered = new Set(discoverWorkspaceNodeTests(fileURLToPath(root)));
  const steps = app.steps;
  const command = steps.map(step => step.run ?? "").join("\n");
  assert.equal(steps.filter(step => step.run === "pnpm check:coverage").length, 1);
  assert.doesNotMatch(command, /--check-discovery/);
  for (const name of ["tools/security/picomatch-redos.test.mjs", "tools/dev/verify-nx-project-graph.test.mjs", "tools/mobile/verify-application-boundaries.test.mjs"]) {
    assert.ok(discovered.has(name), name);
    assert.ok(!ciText.includes(name), "duplicate invocation " + name);
  }
  for (const owner of ["identity", "dsh", "wlt"]) assert.ok(command.includes("pnpm --dir services/" + owner + " contract"));
  for (const value of ["pnpm knip:files", "pnpm check:design", "pnpm check:apps:source", "pnpm -r --if-present run typecheck", "expo export --platform web", "expo export --platform android", "pnpm --dir apps/control-panel build", "node tools/dev/verify-operator-http.mjs"]) assert.ok(command.includes(value), value);
  assert.ok(ci.jobs.workspace_validation.steps.some(step => step.run?.includes("node tools/security/verify-secrets.mjs")));
  assert.ok(dependency.steps.some(step => step.run === "pnpm audit --audit-level high" && !step["continue-on-error"]));
  assert.ok(go.jobs["owner-postgres-integration"].steps.some(step => step.run === "./tests/infra/verify-isolated-postgres.ps1 -DockerContext default"));
  assert.ok(steps.findIndex(step => step.run?.includes("pnpm --dir apps/control-panel build")) < steps.findIndex(step => step.env?.BTHWANI_OPERATOR_HTTP_TEST === "1"));
  for (const step of steps.filter(step => /export --platform|control-panel build|verify-operator-http|verify-expo-web-http|BTHWANI_OPERATOR_HTTP_TEST/.test((step.run ?? "") + JSON.stringify(step.env ?? {})))) assert.equal(step.if, undefined, step.name);
});

test("native Nx feedback selects affected or full targets without claiming full CI", () => {
  const step = feedback.steps.find(item => item.name.startsWith("Run affected native Nx"));
  const source = step.run;
  for (const scenario of [{ before: "a".repeat(40), ancestor: "yes", expected: "affected" }, { before: "000", ancestor: "yes", expected: "run-many" }, { before: "a".repeat(40), ancestor: "no", expected: "run-many" }]) {
    const stub = 'git() { test "$ANCESTOR" = yes; }\npnpm() { printf "%s\\n" "$*"; }\n';
    const result = spawnSync(bash, ["-c", stub + source], { encoding: "utf8", env: {...process.env, BEFORE_SHA: scenario.before, GITHUB_SHA: "b".repeat(40), ANCESTOR: scenario.ancestor} });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("nx " + scenario.expected + " -t typecheck,test"), result.stdout);
    assert.ok(result.stdout.includes("--skip-nx-cache"));
  }
  assert.doesNotMatch(JSON.stringify(feedback), /check:coverage|expo export|verify-owner-postgres-ci/);
});

test("full gate rejects failed, cancelled or skipped prerequisites, wrong events and archive refs", () => {
  const step = required.steps[0];
  const pass = {HEAD_REF:"feature", CI_EVENT:"pull_request", CI_REF:"refs/pull/195/merge", WORKSPACE_RESULT:"success", APPLICATION_RESULT:"success", DEPENDENCY_RESULT:"success", BACKEND_RESULT:"success"};
  const run = env => spawnSync(bash, ["-c",step.run], {encoding:"utf8",env:{...process.env,...env}});
  assert.equal(run(pass).status,0);
  for (const key of ["WORKSPACE_RESULT","APPLICATION_RESULT","DEPENDENCY_RESULT","BACKEND_RESULT"]) for(const value of ["failure","cancelled","skipped",""]) assert.equal(run({...pass,[key]:value}).status,1,key+":"+value);
  assert.equal(run({...pass,CI_EVENT:"push",CI_REF:"refs/heads/main"}).status,0);
  assert.equal(run({...pass,CI_EVENT:"workflow_dispatch",CI_REF:"refs/heads/feature"}).status,0);
  assert.equal(run({...pass,CI_EVENT:"push",CI_REF:"refs/heads/feature"}).status,1);
  assert.equal(run({...pass,CI_EVENT:"schedule"}).status,1);
  assert.equal(run({...pass,HEAD_REF:"archive/old"}).status,1);
  assert.equal(run({...pass,CI_EVENT:"workflow_dispatch",CI_REF:"refs/heads/archive/old"}).status,1);
});

test("Sonar reuses same-run evidence and retains its protected PR context", () => {
  assert.deepEqual(sonar.needs, ["application_quality", "backend_quality"]);
  assert.equal(sonar.name,"${{ github.event_name == 'pull_request' && 'SonarQube Cloud Quality Gate' || 'SonarQube main analysis' }}");
  for (const [producer, artifact] of [[ciText,"sonar-js"],[goText,"sonar-go"],[goText,"sonar-postgres"]]) {
    assert.ok(producer.includes("name: " + artifact));
    assert.ok(ciText.includes("name: " + artifact));
    assert.ok(producer.includes('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'));
  }
  assert.ok(ciText.includes('test "$TRUSTED_SOURCE" = true'));
  assert.ok(ciText.includes('test "$PRESENTATION_RESULT" = success'));
  assert.ok(ciText.includes('test "$GO_RESULT" = success'));
  assert.ok(ciText.includes("steps.coverage.outputs.reuse == 'false'"));
  assert.ok(goText.includes("node tools/dev/check-go.mjs --ci --sonar-report"));
});

test("Go quality runs a pinned fail-closed vulnerability scan for every deployed owner", () => {
  const content = goText;
  const start = content.indexOf("      - name: Scan deployed Go owner source for reachable vulnerabilities");
  const end = content.indexOf("      - name: Build and inspect isolated service images", start);
  assert.ok(start >= 0 && end > start, "missing vulnerability scan before image build");
  const step = content.slice(start, end);
  assert.match(step, /CGO_ENABLED: '0'/);
  assert.match(step, /set -euo pipefail/);
  assert.match(step, /GOBIN="\$scanner_dir" GOSUMDB=sum\.golang\.org go install golang\.org\/x\/vuln\/cmd\/govulncheck@709015412431dd2b5b28a53c06c70bc02d49074c(?:\r?\n|$)/);
  assert.match(step, /for service in identity dsh wlt; do/);
  assert.match(step, /cd "services\/\$service\/backend"/);
  assert.match(step, /"\$scanner" \.\/\.\.\./);
  assert.doesNotMatch(step, /continue-on-error|\|\| true/);
});

test("Sonar coverage admission reuses matching trees and rejects incomplete or inconsistent evidence", () => {
  const content = ciText;
  const step = content.match(/- name: Admit coverage only for the exact analyzed source tree\n[\s\S]*?        run: \|\n([\s\S]*?)\n      - name: Use repository-pinned Node 24/);
  assert.ok(step, "missing executable coverage admission");
  const script = step[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
  const tree = "a".repeat(40), other = "b".repeat(40);
  const scenarios = [
    { name: "same", source: tree, expected: "reuse=true" },
    { name: "different", source: other, expected: "reuse=false" },
    { name: "mixed", source: tree, pgTree: other },
    { name: "invalid-tree", source: tree, reportTree: "not-a-tree" },
    { name: "missing-go", source: tree, missing: "dsh-go.out" },
    { name: "missing-pg", source: tree, missing: "profile.out" },
    { name: "empty-js", source: tree, missing: "lcov.info" },
  ];
  for (const scenario of scenarios) {
    const scratch = mkdtempSync(path.join(tmpdir(), "sonar-tree-admission-"));
    try {
      const reports = path.join(scratch, "reports");
      for (const [artifact, files] of [
        ["sonar-js", ["lcov.info"]],
        ["sonar-go", ["identity-go.out", "dsh-go.out", "wlt-go.out"]],
        ["sonar-postgres", ["profile.out"]],
      ]) {
        const directory = path.join(reports, artifact);
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, "tree.txt"), (artifact === "sonar-postgres" && scenario.pgTree) || scenario.reportTree || tree);
        for (const file of files) if (file !== scenario.missing) writeFileSync(path.join(directory, file), "synthetic admission fixture\n");
      }
      const output = path.join(scratch, "output.txt");
      const result = spawnSync(bash, ["-c", 'git() { test "$*" = "rev-parse HEAD^{tree}" || return 1; printf "%s\\n" "$ANALYZED_TREE"; }\n' + script], {
        cwd: scratch, encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: reports.replaceAll("\\", "/"), GITHUB_OUTPUT: output.replaceAll("\\", "/"), ANALYZED_TREE: scenario.source },
      });
      if (result.error) throw result.error;
      assert.equal(result.status, scenario.expected ? 0 : 1, scenario.name + ": " + result.stderr);
      if (scenario.expected) assert.equal(readFileSync(output, "utf8").trim(), scenario.expected);
      assert.equal(existsSync(path.join(scratch, "coverage", "lcov.info")), scenario.expected === "reuse=true", scenario.name);
      assert.equal(existsSync(path.join(scratch, "coverage", "owner-postgres", "profile.out")), scenario.expected === "reuse=true", scenario.name);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
});
