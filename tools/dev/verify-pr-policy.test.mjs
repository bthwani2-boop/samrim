import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateSonarContract } from "./sonar-contract.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "tools/dev/verify-pr-policy.mjs");
const packageJsonText = fs.readFileSync(path.join(root, "package.json"), "utf8");
const sonarPropertiesText = fs.readFileSync(path.join(root, "sonar-project.properties"), "utf8");
const workflowText = fs.readFileSync(path.join(root, ".github/workflows/sonar-observe.yml"), "utf8");

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

test("Sonar contract matches the canonical project version and new-code scope", () => {
  assert.deepEqual(validateSonarContract({ packageJsonText, sonarPropertiesText, workflowText }), []);
});

test("Sonar contract rejects project-version drift", () => {
  const drifted = sonarPropertiesText.replace(/sonar\.projectVersion=.*$/m, "sonar.projectVersion=999.999.999");
  const findings = validateSonarContract({ packageJsonText, sonarPropertiesText: drifted, workflowText });
  assert.ok(findings.some((item) => item.code === "SONAR_PROJECT_VERSION_DRIFT"));
});

test("Sonar contract rejects analysis that is widened beyond the exact pull request", () => {
  const widened = workflowText.replace('scope="pullRequest=${SONAR_PULL_REQUEST:?PR number is required for Sonar Cloud PR analysis}"', 'scope="branch=main"');
  const findings = validateSonarContract({ packageJsonText, sonarPropertiesText, workflowText: widened });
  assert.ok(findings.some((item) => item.code === "SONAR_PULL_REQUEST_SCOPE_MISSING"));
});

test("Sonar contract rejects push and manual-run analysis triggers", () => {
  const widened = workflowText.replace("on:\n  pull_request:", "on:\n  push:\n    branches: [main]\n  pull_request:");
  const findings = validateSonarContract({ packageJsonText, sonarPropertiesText, workflowText: widened });
  assert.ok(findings.some((item) => item.code === "SONAR_WORKFLOW_NOT_PR_ONLY"));
});

test("Sonar contract rejects build identifiers masquerading as project versions", () => {
  const poisoned = `${workflowText}\n# sonar.projectVersion=${"${CANDIDATE_SHA}"}\n`;
  const findings = validateSonarContract({ packageJsonText, sonarPropertiesText, workflowText: poisoned });
  assert.ok(findings.some((item) => item.code === "SONAR_BUILD_ID_USED_AS_PROJECT_VERSION"));
});

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
