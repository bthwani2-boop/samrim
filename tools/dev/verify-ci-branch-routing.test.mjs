import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  return { content, push: block("push"), pr: block("pull_request") };
}

for (const file of workflows) {
  test(file + " handles future branches and excludes historical archives", () => {
    const { push, pr } = events(file);
    assert.match(push, /^    branches:\n      - '\*\*'\n      - '!archive\/\*\*'\n      - '!41'$/m);
    assert.doesNotMatch(push, /^    branches-ignore:/m);
    assert.doesNotMatch(push, /refoundation\/clean-house-20261112/);
    assert.match(pr, /^    branches:\n      - main$/m);
    assert.doesNotMatch(pr, /refoundation\/clean-house-20261112/);
    if (file.endsWith("/ci.yml")) {
      assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m);
      assert.doesNotMatch(pr, /^    paths(?:-ignore)?:/m);
    } else {
      assert.match(push, /^    paths:/m);
      assert.match(pr, /^    paths:/m);
    }
  });
}

test("fast-guard remains required on every eligible push and main PR", () => {
  const { content, push, pr } = events(workflows[0]);
  assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m);
  assert.match(pr, /^    branches:\n      - main$/m);
  assert.match(content, /^    name: fast-guard$/m);
  assert.match(content, /^    needs: \[foundation, presentation\]$/m);
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

test("SQL migration changes trigger the existing Go quality and Nx dependency workflows", () => {
  for (const file of [workflows[1], workflows[2]]) {
    const { push, pr } = events(file);
    assert.match(push, /^      - 'services\/\*\*\/database\/migrations\/\*\*'$/m, file + ": missing SQL push path");
    assert.match(pr, /^      - 'services\/\*\*\/database\/migrations\/\*\*'$/m, file + ": missing SQL PR path");
  }
});

test("the disposable PostgreSQL job routes and runs the DSH restore rehearsal", () => {
  const { content, push, pr } = events(workflows[2]);
  const restoreScript = /^ {6}- 'infra\/verify-isolated-postgres\.ps1'$/m;
  assert.match(push, restoreScript);
  assert.match(pr, restoreScript);
  const job = content.slice(content.indexOf("\n  owner-postgres-integration:\n"));
  assert.match(job, /shell: pwsh\n {8}run: \.\/infra\/verify-isolated-postgres\.ps1 -DockerContext default/);
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
