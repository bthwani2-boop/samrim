import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

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
    assert.match(push, /^    branches:\n      - '\*\*'\n      - '!archive\/\*\*'\n      - '!41'$/m);
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

test("fast-guard remains required on every eligible push and main PR", () => {
  const { content, push, pr } = events(workflows[0]);
  assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m);
  assert.match(pr, /^    branches:\n      - main$/m);
  assert.match(content, /^    name: fast-guard$/m);
  assert.match(content, /^    needs: \[foundation, presentation, dependency_pr, go_pr\]$/m);
  assert.match(content, /^    if: \$\{\{ !cancelled\(\) \}\}$/m);
  assert.match(content, /^      - name: Refuse read-only archive as main PR source$/m);
  assert.match(content, /^            archive\/\*\|41\)$/m);
});

test("every supported development branch executes discovered Feature regression tests before fast-guard", () => {
  const { content } = events(workflows[0]);
  const install = content.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
  const coverage = content.indexOf("Run discovered Feature tests and collect measured coverage");
  const fastGuard = content.indexOf("  fast_guard:");
  assert.ok(install >= 0 && coverage > install && fastGuard > coverage,
    "Feature test discovery must run after dependency install and before required fast-guard");
  assert.match(content, /^      - name: Run discovered Feature tests and collect measured coverage\n        run: pnpm check:coverage$/m);
});

test("Operator HTTP checks run after the production Next build, not as source coverage", () => {
  const { content } = events(workflows[0]);
  const build = content.indexOf("name: Build the pinned Next.js Operator presentation host");
  const smoke = content.indexOf("name: Exercise production Operator session and policy routes");
  assert.ok(build >= 0 && smoke > build, "Operator auth/route HTTP checks must execute after the Next build");
  const step = content.slice(smoke, content.indexOf("\n  fast_guard:", smoke));
  assert.match(step, /BTHWANI_OPERATOR_HTTP_TEST: '1'/);
  assert.match(step, /node --test --test-concurrency=1/);
  for (const name of ["protected-routes", "workspace-http", "policy-http"]) {
    assert.ok(step.includes(`apps/control-panel/tests/operator-${name}.test.mjs`));
  }
});

test("CI must reject unadmitted new tests before coverage and fast-guard", () => {
  const { content } = events(workflows[0]);
  const install = content.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
  const admission = content.indexOf("run: pnpm check:test-inclusion");
  const coverage = content.indexOf("run: pnpm check:coverage");
  const fastGuard = content.indexOf("  fast_guard:");
  assert.ok(install >= 0 && admission > install && coverage > admission && fastGuard > coverage,
    "CI must prove new test inclusion after install and before coverage/fast-guard");
  assert.match(content, /^      - name: Reject unadmitted new Feature tests\n        run: pnpm check:test-inclusion$/m);
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

test("CI retains real security and contract checks without the retired scaffold guard", () => {
  const { content } = events(workflows[0]);
  assert.doesNotMatch(content, /tools\/governance\/verify-foundation(?:\.test)?\.mjs/);
  assert.match(content, /node --test tools\/security\/verify-secrets\.test\.mjs/);
  assert.match(content, /node tools\/security\/verify-secrets\.mjs/);
  assert.match(content, /node --test tools\/dev\/check-openapi\.test\.mjs/);
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
    ["dependency_pr", workflows[1]],
    ["go_pr", workflows[2]],
  ]) {
    const lines = content.split("\n");
    const header = "  " + job + ":";
    const index = lines.indexOf(header);
    assert.ok(index >= 0, "Missing required reusable job: " + job);
    assert.equal(lines.lastIndexOf(header), index, "Duplicate reusable job: " + job);
    assert.deepEqual(lines.slice(index + 1, index + 3), [
      job === "go_pr"
        ? "    if: ${{ github.event_name == 'pull_request' || (github.event_name == 'push' && github.ref == 'refs/heads/main') }}"
        : "    if: ${{ github.event_name == 'pull_request' }}",
      "    uses: ./" + file,
    ]);
    const called = readFileSync(new URL(file, root), "utf8").split(/^permissions:/m)[0];
    assert.match(called, /^  workflow_call:$/m);
    assert.doesNotMatch(called, /^  pull_request:/m, "PR must run through one owner workflow call");
  }
  assert.match(content, /^    needs: \[foundation, presentation, dependency_pr, go_pr\]$/m);
});

test("required gate fails closed for missing, skipped, cancelled or failed main PR owner checks", () => {
  const { content } = events(workflows[0]);
  const script = content.match(/node --input-type=module <<'CI_GATE'\n([\s\S]*?)\n          CI_GATE/);
  assert.ok(script, "required gate must expose executable predecessor decision");
  const pass = {
    CI_EVENT: "pull_request",
    CI_REF: "refs/pull/195/merge",
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
  assert.equal(run({ ...mainPush, GO_RESULT: "skipped" }).status, 1);
  assert.equal(run({ ...pass, CI_EVENT: "unexpected" }).status, 1);
});

test("Sonar uses one same-run coverage handoff and retains the required check", () => {
  const { content } = events(workflows[0]);
  const go = readFileSync(new URL(workflows[2], root), "utf8");
  assert.equal(existsSync(new URL(".github/workflows/sonar-quality.yml", root)), false);
  assert.match(content, /^    name: SonarQube Cloud Quality Gate$/m);
  assert.match(content, /^    needs: \[presentation, go_pr\]$/m);
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
