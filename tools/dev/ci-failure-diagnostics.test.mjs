import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeCommandLog, buildAgentDiagnostic } from "./ci-failure-diagnostics.mjs";

function tempLog(lines) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samrim-ci-diagnostic-test-"));
  const logPath = path.join(directory, "proof.log");
  fs.writeFileSync(logPath, lines.join("\n") + "\n");
  return logPath;
}

test("successful test names containing error or failure are not findings", () => {
  const logPath = tempLog([
    "✓ Captain reenrollment reconciles a server error against canonical state",
    "✓ identity service failure is exposed as an alert",
    "DSH_RUNTIME=FAIL canonical checkout rejected detail={}",
  ]);
  const result = analyzeCommandLog(logPath, "runtime-integration");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].marker, "DSH_RUNTIME");
});

test("bounded batch collects every explicit material finding", () => {
  const logPath = tempLog([
    "STATICCHECK=FAIL package=a",
    "ACTIONLINT=FAIL workflow=ci.yml",
    "Found 2 errors",
  ]);
  const result = analyzeCommandLog(logPath, "static-affected");
  assert.deepEqual(result.findings.map((finding) => finding.marker), ["STATICCHECK", "ACTIONLINT", "TOOL_ERROR_SUMMARY"]);
});

test("Nx failed task section records every failed target", () => {
  const logPath = tempLog([
    "Failed tasks:",
    "- app-client:typecheck",
    "- dsh-backend:vet",
    "Run duration: 1s",
  ]);
  const result = analyzeCommandLog(logPath, "static-affected");
  assert.deepEqual(result.failedTargets, ["app-client:typecheck", "dsh-backend:vet"]);
});

test("runtime completed targets stay reusable while failed target blocks progression", () => {
  const logPath = tempLog([
    "CI_RUNTIME_TASK=PASS target=identity-backend:runtime-proof",
    "CI_RUNTIME_TASK=PASS target=wlt-backend:financial-invariants",
    "CI_RUNTIME_TASK=FAIL target=dsh-backend:runtime-proof",
  ]);
  const diagnostic = buildAgentDiagnostic({
    metadata: { kind: "runtime", sha: "abc" },
    metricRecords: [{ name: "runtime-integration", exitCode: 1, durationMs: 10, logPath }],
    runtimeFailure: { target: "dsh-backend:runtime-proof" },
  });
  assert.deepEqual(diagnostic.completedTargets, ["identity-backend:runtime-proof", "wlt-backend:financial-invariants"]);
  assert.deepEqual(diagnostic.failedTargets, ["dsh-backend:runtime-proof"]);
  assert.equal(diagnostic.progressionBlocked, true);
  assert.equal(diagnostic.rootCauseStatus, "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW");
});

test("external action failures join the same agent diagnostic", () => {
  const diagnostic = buildAgentDiagnostic({
    metadata: { kind: "security", sha: "abc" },
    externalRecords: [{ name: "dependency-review", outcome: "failure", source: "actions/dependency-review-action@sha" }],
  });
  assert.equal(diagnostic.materialFindings.length, 1);
  assert.equal(diagnostic.materialFindings[0].kind, "EXTERNAL_ACTION_FAILURE");
  assert.deepEqual(diagnostic.reproofHints, ["dependency-review"]);
});
