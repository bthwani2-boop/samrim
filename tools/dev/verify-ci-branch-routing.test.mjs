import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverWorkspaceNodeTests } from "./source-test-discovery.mjs";

const root = new URL("../../", import.meta.url);
const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/dependency-nx-safety.yml",
  ".github/workflows/go-quality.yml",
];

function events(file) {
  const content = readFileSync(new URL(file, root), "utf8");
  const header = content.split(/^permissions:/m)[0];
  const lines = header.split("\n");
  assert.ok(lines.includes("on:"), file + ": missing events");
  function block(name) {
    const start = lines.indexOf("  " + name + ":");
    assert.ok(start >= 0, file + ": missing " + name + " event");
    let end = start + 1;
    while (end < lines.length && !/^  [a-z_]+:$/.test(lines[end])) end++;
    return lines.slice(start + 1, end).join("\n");
  }
  return { content, push: block("push"), pr: lines.includes("  pull_request:") ? block("pull_request") : null };
}

for (const file of workflows) {
  test(file + " handles future branches and excludes historical archives", () => {
    const { content, push, pr } = events(file);
    assert.match(push, /^    branches:\n      - '\*\*'\n      - '!archive\/\*\*'$/m);
    if (file.endsWith("/go-quality.yml")) assert.match(push, /^      - '!main'$/m);
    else assert.doesNotMatch(push, /^      - '!main'$/m);
    assert.doesNotMatch(push, /^    branches-ignore:/m);
    assert.doesNotMatch(push, /refoundation\/clean-house-20261112/);
    if (file.endsWith("/ci.yml")) {
      assert.match(pr, /^    branches:\n      - main$/m);
      assert.doesNotMatch(pr, /refoundation\/clean-house-20261112/);
      assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m);
      assert.doesNotMatch(pr, /^    paths(?:-ignore)?:/m);
    } else {
      assert.match(push, /^    paths:/m);
      assert.equal(pr, null, "main PRs use the required CI caller, never path-filtered PR events");
      assert.match(content, /^  workflow_call:$/m);
    }
  });
}

test("main PR retains the required gate; development push cannot publish its name", () => {
  const { content, push, pr } = events(workflows[0]);
  assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m);
  assert.match(pr, /^    branches:\n      - main$/m);
  assert.ok(content.includes("name: ${{ github.event_name == 'pull_request' && 'fast-guard' || 'development-ci' }}"));
  assert.match(content, /^    needs: \[workspace_validation, application_quality, dependency_security, backend_quality\]$/m);
  assert.match(content, /^    if: \$\{\{ !cancelled\(\) \}\}$/m);
  assert.match(content, /^      - name: Refuse read-only archive as main PR source$/m);
  assert.match(content, /^            archive\/\*\)$/m);
});

test("every supported development branch executes discovered Feature regression tests before fast-guard", () => {
  const { content } = events(workflows[0]);
  const install = content.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
  const coverage = content.indexOf("Run discovered Feature tests and collect measured coverage");
  const fastGuard = content.indexOf("  required_ci:");
  assert.ok(install >= 0 && coverage > install && fastGuard > coverage,
    "Feature test discovery must run after dependency install and before required fast-guard");
  assert.match(content, /^      - name: Run discovered Feature tests and collect measured coverage\n        run: pnpm check:coverage$/m);
});

test("Operator HTTP checks run after the production Next build, not as source coverage", () => {
  const { content } = events(workflows[0]);
  const build = content.indexOf("name: Build the pinned Next.js Operator presentation host");
  const smoke = content.indexOf("name: Exercise production Operator session and policy routes");
  assert.ok(build >= 0 && smoke > build, "Operator auth/route HTTP checks must execute after the Next build");
  const step = content.slice(smoke, content.indexOf("\n  required_ci:", smoke));
  assert.match(step, /BTHWANI_OPERATOR_HTTP_TEST: '1'/);
  assert.match(step, /node --test --test-concurrency=1/);
  for (const name of ["protected-routes", "workspace-http", "policy-http"]) {
    assert.ok(step.includes(`apps/control-panel/tests/operator-${name}.test.mjs`));
  }
});

test("CI must verify source test discovery before coverage and fast-guard", () => {
  const { content } = events(workflows[0]);
  const install = content.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
  const admission = content.indexOf("run: node tools/dev/run-coverage.mjs --check-discovery");
  const coverage = content.indexOf("run: pnpm check:coverage");
  const fastGuard = content.indexOf("  required_ci:");
  assert.ok(install >= 0 && admission > install && coverage > admission && fastGuard > coverage,
    "CI must prove new test inclusion after install and before coverage/fast-guard");
  assert.match(content, /^        run: node tools\/dev\/run-coverage\.mjs --check-discovery$/m);
});

test("SQL baseline, sandbox and retained migration changes trigger Go quality and Nx dependency workflows", () => {
  for (const file of [workflows[1], workflows[2]]) {
    const { push, pr } = events(file);
    assert.equal(pr, null, file + ": PR calls must be unconditional");
    for (const pattern of [
      "services/**/database/migrations/**",
      "services/**/database/schema/**",
      "services/wlt/database/sandbox/**",
    ]) {
      assert.ok(push.includes("      - '" + pattern + "'"), file + ": missing push " + pattern);
    }
  }
});

test("the disposable PostgreSQL job routes and runs the DSH restore rehearsal", () => {
  const { content, push, pr } = events(workflows[2]);
  const restoreScript = /^ {6}- 'tests\/infra\/verify-isolated-postgres\.ps1'$/m;
  assert.match(push, restoreScript);
  assert.equal(pr, null);
  const job = content.slice(content.indexOf("\n  owner-postgres-integration:\n"));
  assert.match(job, /shell: pwsh\n {8}run: \.\/tests\/infra\/verify-isolated-postgres\.ps1 -DockerContext default/);
});

test("full source coverage replaces repeated application and infrastructure test invocations", () => {
  const { content } = events(workflows[0]);
  const tests = new Set(discoverWorkspaceNodeTests(fileURLToPath(root)));
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const localAppChecks = pkg.scripts["check:apps"];
  const staticAppChecks = pkg.scripts["check:apps:source"];
  assert.ok(staticAppChecks, "missing reusable static checks");
  assert.ok(localAppChecks.includes("pnpm run check:apps:static"));
  for (const file of [
    "tools/dev/verify-workspace.test.mjs",
    "tools/dev/verify-ci-branch-routing.test.mjs",
    "tools/dev/check-openapi.test.mjs",
    "tests/infra/compose-policy.test.mjs",
    "tests/infra/verify-runtime-provenance.test.mjs",
    "tools/mobile/verify-rtl.test.mjs",
    "tools/security/verify-secrets.test.mjs",
    ...localAppChecks.split(" ").filter(value => value.endsWith(".test.mjs")),
  ]) {
    assert.ok(tests.has(file), "not discovered by coverage: " + file);
    assert.ok(!content.includes(file), "duplicate explicit test in CI: " + file);
  }
  for (const command of ["verify-app-foundations.mjs", "verify-rtl.mjs", "verify-expo-config.mjs", "verify-application-boundaries.mjs"]) {
    assert.ok(staticAppChecks.includes(command), "missing actual check: " + command);
  }
  assert.match(content, /pnpm check:apps:source/);
  assert.match(pkg.scripts["check:apps:static"], /pnpm run check:apps:source && pnpm -r --if-present run typecheck/);
  assert.match(content, /pnpm exec nx affected -t typecheck/);
  assert.match(content, /pnpm -r --if-present run typecheck/);
});

test("CI retains real security and contract checks without the retired scaffold guard", () => {
  const { content } = events(workflows[0]);
  assert.doesNotMatch(content, /tools\/governance\/verify-foundation(?:\.test)?\.mjs/);
  assert.match(content, /node tools\/security\/verify-secrets\.mjs/);
  for (const owner of ["identity", "dsh", "wlt"]) assert.ok(content.includes("pnpm --dir services/" + owner + " contract"));
  assert.match(content, /run: pnpm check:coverage/);
  const coverage = readFileSync(new URL("tools/dev/run-coverage.mjs", root), "utf8");
  assert.doesNotMatch(coverage, /verify-foundation/);
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(pkg.scripts["check:foundation"], undefined);
  assert.match(pkg.scripts.check, /check:security/);
  assert.match(pkg.scripts.check, /check:apps/);
});

test("the relocated disposable WebAuthn stack still triggers owner CI", () => {
  const { push, pr } = events(workflows[2]);
  const pattern = "      - 'tests/infra/compose.operator-webauthn-sandbox.yaml'";
  assert.ok(push.includes(pattern));
  assert.equal(pr, null);
});

test("CI reruns the relevant checks when shared toolchain or dependency inputs change", () => {
  for (const file of [workflows[1], workflows[2]]) {
    const { push } = events(file);
    assert.ok(push.includes("      - '.node-version'"), file + ": missing pinned Node trigger");
  }
  const { push } = events(workflows[1]);
  for (const pattern of [".npmrc", "tsconfig.base.json", "**/tsconfig.json", "patches/**"]) {
    assert.ok(push.includes("      - '" + pattern + "'"), "Dependency/Nx missing " + pattern);
  }
});

test("explicit candidate verification is isolated from automatic run cancellation", () => {
  for (const file of workflows) {
    const { content } = events(file);
    const group = content.split("\n").find((line) => line.startsWith("  group: "));
    assert.ok(group, file + ": missing concurrency group");
    assert.ok(group.includes("${{ github.ref }}"), file + ": missing ref scope");
    assert.ok(group.includes("${{ github.event_name == 'workflow_dispatch' && format('manual-{0}', github.sha) || github.event_name }}"), file + ": manual verification must be isolated by candidate SHA and automatic event");
    assert.match(content, /^  cancel-in-progress: true$/m);
  }
});

test("Go quality runs a pinned fail-closed vulnerability scan for every deployed owner", () => {
  const { content } = events(workflows[2]);
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

test("main PR must invoke all owner and dependency checks through required fast-guard", () => {
  const { content, pr } = events(workflows[0]);
  assert.doesNotMatch(pr, /^    paths(?:-ignore)?:/m);
  for (const [job, file] of [
    ["dependency_security", workflows[1]],
    ["backend_quality", workflows[2]],
  ]) {
    const lines = content.split("\n");
    const header = "  " + job + ":";
    const index = lines.indexOf(header);
    assert.ok(index >= 0, "Missing required reusable job: " + job);
    assert.equal(lines.lastIndexOf(header), index, "Duplicate reusable job: " + job);
    assert.deepEqual(lines.slice(index + 1, index + 3), [
      job === "backend_quality"
        ? "    if: ${{ github.event_name == 'pull_request' || (github.event_name == 'push' && github.ref == 'refs/heads/main') }}"
        : "    if: ${{ github.event_name == 'pull_request' }}",
      "    uses: ./" + file,
    ]);
    const called = readFileSync(new URL(file, root), "utf8").split(/^permissions:/m)[0];
    assert.match(called, /^  workflow_call:$/m);
    assert.doesNotMatch(called, /^  pull_request:/m, "PR must run through one owner workflow call");
  }
  assert.match(content, /^    needs: \[workspace_validation, application_quality, dependency_security, backend_quality\]$/m);
});

test("required gate fails closed for missing, skipped, cancelled or failed main PR owner checks", () => {
  const { content } = events(workflows[0]);
  const script = content.match(/node --input-type=module <<'CI_GATE'\n([\s\S]*?)\n          CI_GATE/);
  assert.ok(script, "required gate must expose executable predecessor decision");
  const pass = {
    CI_EVENT: "pull_request",
    CI_REF: "refs/pull/195/merge",
    FULL_SCOPE: "true",
    FOUNDATION_RESULT: "success",
    PRESENTATION_RESULT: "success",
    DEPENDENCY_RESULT: "success",
    GO_RESULT: "success",
  };
  const run = (env) =>
    spawnSync(process.execPath, ["--input-type=module"], {
      input: script[1],
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  assert.equal(run(pass).status, 0);
  for (const full of ['false', '', 'unknown']) assert.equal(run({...pass, FULL_SCOPE: full}).status, 1);
  for (const key of ["FOUNDATION_RESULT", "PRESENTATION_RESULT", "DEPENDENCY_RESULT", "GO_RESULT"]) {
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      assert.equal(run({ ...pass, [key]: result }).status, 1, key + ": " + result);
    }
  }
  for (const event of ["push", "workflow_dispatch"]) {
    const scoped = { ...pass, CI_EVENT: event, CI_REF: "refs/heads/development", DEPENDENCY_RESULT: "skipped", GO_RESULT: "skipped" };
    assert.equal(run(scoped).status, 0);
    assert.equal(run({ ...scoped, FOUNDATION_RESULT: "failure" }).status, 1);
    assert.equal(run({ ...scoped, GO_RESULT: "failure" }).status, 1);
  }
  const mainPush = { ...pass, CI_EVENT: "push", CI_REF: "refs/heads/main", DEPENDENCY_RESULT: "skipped" };
  assert.equal(run(mainPush).status, 0);
  assert.equal(run({...mainPush, FULL_SCOPE: 'false'}).status, 1);
  assert.equal(run({...pass, CI_EVENT: 'push', CI_REF: 'refs/heads/development', FULL_SCOPE: 'false', DEPENDENCY_RESULT: 'skipped', GO_RESULT: 'skipped'}).status, 0);
  assert.equal(run({ ...mainPush, GO_RESULT: "skipped" }).status, 1);
  assert.equal(run({ ...pass, CI_EVENT: "unexpected" }).status, 1);
});

test("Sonar uses one same-run coverage handoff and retains the required check", () => {
  const { content } = events(workflows[0]);
  const go = readFileSync(new URL(workflows[2], root), "utf8");
  assert.equal(existsSync(new URL(".github/workflows/sonar-quality.yml", root)), false);
  assert.ok(content.includes("name: ${{ github.event_name == 'pull_request' && 'SonarQube Cloud Quality Gate' || 'SonarQube main analysis' }}"));
  assert.match(content, /^    needs: \[application_quality, backend_quality\]$/m);
  for (const [producer, artifact] of [[content, "sonar-js"], [go, "sonar-go"], [go, "sonar-postgres"]]) {
    assert.ok(producer.includes("name: " + artifact));
    assert.ok(content.includes("name: " + artifact));
    assert.ok(producer.includes("test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\""));
  }
  assert.ok(content.includes("test \"$TRUSTED_SOURCE\" = true"));
  assert.ok(content.includes("test \"$PRESENTATION_RESULT\" = success"));
  assert.ok(content.includes("test \"$GO_RESULT\" = success"));
  assert.ok(content.includes("steps.coverage.outputs.reuse == 'false'"));
  assert.ok(go.includes("node tools/dev/check-go.mjs --ci --sonar-report"));
});

test("Sonar coverage admission reuses matching trees and rejects incomplete or inconsistent evidence", () => {
  const { content } = events(workflows[0]);
  const step = content.match(/- name: Admit coverage only for the exact analyzed source tree\n[\s\S]*?        run: \|\n([\s\S]*?)\n      - name: Use repository-pinned Node 24/);
  assert.ok(step, "missing executable coverage admission");
  const script = step[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
  const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
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

test("development build scope uses Nx for recognized app changes and defaults to full on ambiguity", () => {
  const { content } = events(workflows[0]);
  const step = content.match(/- name: Determine affected development build scope\n[\s\S]*?        run: \|\n([\s\S]*?)\n      - name: Validate owner OpenAPI/);
  assert.ok(step);
  const script = step[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
  const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
  const cases = [
    { expected: false },
    { event: "pull_request", expected: true },
    { event: "workflow_dispatch", expected: true },
    { ref: "refs/heads/main", expected: true },
    { before: "000", expected: true },
    { ancestor: "no", expected: true },
    { files: "package.json", expected: true },
    { files: "apps/customer/src/App.tsx\npackages/design-system/src/index.ts", expected: true },
    { nx: "[]", expected: true },
    { nx: '["@bthwani/merchant"]', expected: true },
    { nx: "invalid", expected: true },
    { nx: '["@bthwani/customer","@bthwani/merchant"]', expected: false },
    { nxFail: "yes", expected: true },
  ];
  for (const scenario of cases) {
    const scratch = mkdtempSync(path.join(tmpdir(), "ci-scope-"));
    try {
      const output = path.join(scratch, "output.txt").replaceAll("\\", "/");
      const stubs = 'git() { case "$1" in merge-base) test "$ANCESTOR" = yes;; diff) printf "%s\\n" "$CHANGED_FILES";; *) return 1;; esac; }\npnpm() { test "$NX_FAIL" != yes || return 1; printf "%s\\n" "$NX_RESULT"; }\n';
      const result = spawnSync(bash, ["-c", stubs + script], {
        cwd: scratch,
        encoding: "utf8",
        env: {
          ...process.env, GITHUB_OUTPUT: output, RUNNER_TEMP: scratch.replaceAll("\\", "/"),
          GITHUB_EVENT_NAME: scenario.event ?? "push", GITHUB_REF: scenario.ref ?? "refs/heads/development",
          BEFORE_SHA: scenario.before ?? "a".repeat(40), GITHUB_SHA: "b".repeat(40),
          ANCESTOR: scenario.ancestor ?? "yes", CHANGED_FILES: scenario.files ?? "apps/customer/src/App.tsx",
          NX_RESULT: scenario.nx ?? '["@bthwani/customer"]', NX_FAIL: scenario.nxFail ?? "no",
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const actual = readFileSync(output, "utf8");
      assert.ok(actual.includes("full=" + scenario.expected + "\n"), JSON.stringify(scenario) + actual);
      if (scenario.expected) assert.ok(actual.includes("projects=[]"));
      else assert.ok(actual.includes("projects=" + (scenario.nx ?? '["@bthwani/customer"]')));
    } finally { rmSync(scratch, {recursive:true,force:true}); }
  }
});
