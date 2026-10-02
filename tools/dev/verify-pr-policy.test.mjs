import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "tools/dev/verify-pr-policy.mjs");

function run(extraEnv) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GH_EVENT: "pull_request",
      PR_TITLE: "Valid draft title",
      PR_BODY: "",
      PR_DRAFT: "false",
      PR_BASE_SHA: "",
      ...extraEnv,
    },
  });
}

test("draft PR defers ready-only policy without falling through", () => {
  const result = run({ PR_DRAFT: "true" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR_POLICY_DRAFT=DEFERRED_UNTIL_READY/);
  assert.match(result.stdout, /PR_POLICY=PASS/);
  assert.doesNotMatch(result.stderr, /POLICY_FINDING=FAIL/);
});

test("ready PR bounded batch reports all cheap independent policy findings once", () => {
  const result = run({ PR_DRAFT: "false" });
  assert.equal(result.status, 1);
  const findings = result.stderr.split(/\r?\n/).filter((line) => line.startsWith("POLICY_FINDING=FAIL"));
  assert.ok(findings.length >= 7, `expected bounded finding harvest, observed ${findings.length}\n${result.stderr}`);
  assert.match(result.stderr, /code=PR_BODY_TOO_SHORT/);
  assert.match(result.stderr, /code=PR_SECTION_MISSING/);
  assert.match(result.stderr, /code=GOVERNANCE_IMPACT_CARDINALITY/);
  assert.match(result.stderr, /code=PR_BASE_SHA_MISSING/);
  assert.match(result.stderr, /PR_POLICY=FAIL count=/);
});
