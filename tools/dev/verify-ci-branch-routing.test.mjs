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
