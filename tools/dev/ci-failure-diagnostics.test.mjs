import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeCommandLog, buildClosureDiagnostic } from "./ci-failure-diagnostics.mjs";
import { redactFailureArtifact } from "./ci-failure-redaction.mjs";

function tempLog(lines) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samrim-ci-diagnostic-test-"));
  const logPath = path.join(directory, "proof.log");
  fs.writeFileSync(logPath, lines.join("\n") + "\n");
  return logPath;
}

test("failure artifact redaction removes every supported credential shape and prefers longest exact secrets", () => {
  const sensitiveValues = new Map([
    ["alpha-secret", "SHORT_SECRET"],
    ["alpha-secret-long", "LONG_SECRET"],
  ]);
  const input = [
    "exact alpha-secret-long and alpha-secret",
    "Authorization: Bearer AbcdEF12._~+/-",
    `token=${["ghp_", "1234567890", "abcdefghij"].join("")}`,
    `token=${["github", "_pat_", "1234567890", "abcdefghij"].join("")}`,
    `token=${["sk", "-", "1234567890", "abcdefghij"].join("")}`,
    "jwt=eyJabcdefgh.abcdefgh.abcdefgh",
    "url=https://alice:s3cr3t@example.com/path",
    '{"password":"json-secret"}',
    'api_key = "quoted-secret"',
    "client-secret='single-secret'",
    "access_token=plain-secret",
  ].join("\n");

  const redacted = redactFailureArtifact(input, sensitiveValues);
  assert.match(redacted, /\[REDACTED:LONG_SECRET\]/);
  assert.match(redacted, /\[REDACTED:SHORT_SECRET\]/);
  assert.match(redacted, /Bearer \[REDACTED:bearer\]/);
  assert.equal((redacted.match(/\[REDACTED:token\]/g) ?? []).length, 3);
  assert.match(redacted, /jwt=\[REDACTED:jwt\]/);
  assert.match(redacted, /https:\/\/alice:\[REDACTED:credential\]@example\.com\/path/);
  assert.match(redacted, /"password":"\[REDACTED\]"/);
  assert.match(redacted, /api_key = "\[REDACTED\]"/);
  assert.match(redacted, /client-secret='\[REDACTED\]'/);
  assert.match(redacted, /access_token=\[REDACTED\]/);
  assert.doesNotMatch(redacted, /alpha-secret|s3cr3t|json-secret|quoted-secret|single-secret|plain-secret/);
});

test("failure artifact redaction preserves benign text and normalizes nullish input", () => {
  assert.equal(redactFailureArtifact("safe diagnostic text"), "safe diagnostic text");
  assert.equal(redactFailureArtifact(null), "");
});

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

test("identical repeated findings are deduplicated by stable fingerprint", () => {
  const logPath = tempLog([
    "STATICCHECK=FAIL package=a",
    "STATICCHECK=FAIL package=a",
  ]);
  const result = analyzeCommandLog(logPath, "static-affected");
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].id, /^F-[a-f0-9]{12}$/);
  assert.equal(result.findings[0].class, "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW");
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
  const diagnostic = buildClosureDiagnostic({
    metadata: { kind: "runtime", sha: "abc", nxBase: "base", nxHead: "abc", branch: "z" },
    metricRecords: [{ name: "runtime-integration", exitCode: 1, durationMs: 10, logPath }],
    runtimeFailure: { target: "dsh-backend:runtime-proof" },
    affectedProjects: ["dsh-backend"],
  });
  assert.equal(diagnostic.artifactClass, "CAUSAL_DIAGNOSTIC_CLOSURE");
  assert.deepEqual(diagnostic.completedTargets, ["identity-backend:runtime-proof", "wlt-backend:financial-invariants"]);
  assert.deepEqual(diagnostic.failedTargets, ["dsh-backend:runtime-proof"]);
  assert.equal(diagnostic.closure.progressionBlocked, true);
  assert.equal(diagnostic.closure.rootCauseStatus, "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW");
  assert.equal(diagnostic.closure.highestPriorityRoot, null);
  assert.deepEqual(diagnostic.scope.affectedProjects, ["dsh-backend"]);
  assert.deepEqual(diagnostic.execution.selectedProofs, ["runtime-integration"]);
  assert.deepEqual(diagnostic.closure.smallestFalsifyingProof, ["dsh-backend:runtime-proof"]);
});

test("runtime START context collapses leaf failure and wrapper symptoms under the leaf owner without inventing root cause", () => {
  const logPath = tempLog([
    "CI_RUNTIME_TASK=START target=dsh-backend:runtime-proof",
    "DSH_RUNTIME=FAIL payment service unavailable",
    "Failed tasks:",
    "- dsh-backend:runtime-proof",
    "Run duration: 1s",
    "CI_RUNTIME_TASK=FAIL target=dsh-backend:runtime-proof",
    "Failed tasks:",
    "- repository-ci:runtime-integration",
    "Run duration: 2s",
  ]);
  const diagnostic = buildClosureDiagnostic({
    metadata: { kind: "runtime", sha: "abc" },
    metricRecords: [{ name: "runtime-integration", exitCode: 1, logPath }],
    runtimeFailure: { target: "dsh-backend:runtime-proof" },
  });
  assert.ok(diagnostic.findings.length >= 3);
  assert.deepEqual([...new Set(diagnostic.findings.map((finding) => finding.owner))], ["dsh-backend"]);
  assert.equal(diagnostic.causalGroups.length, 1);
  assert.equal(diagnostic.causalGroups[0].canonicalOwner, "dsh-backend");
  assert.equal(diagnostic.causalGroups[0].rootCandidate, null);
  assert.equal(diagnostic.causalGroups[0].confidence, "UNCLASSIFIED");
  assert.deepEqual(diagnostic.closure.smallestFalsifyingProof, ["dsh-backend:runtime-proof"]);
});

test("causal groups correlate by owner without inventing a root cause", () => {
  const logPath = tempLog([
    "Failed tasks:",
    "- dsh-backend:vet",
    "- dsh-backend:unit",
    "Run duration: 1s",
  ]);
  const diagnostic = buildClosureDiagnostic({
    metadata: { kind: "static-linux", sha: "abc" },
    metricRecords: [{ name: "static-affected", exitCode: 1, logPath }],
  });
  assert.equal(diagnostic.causalGroups.length, 1);
  assert.equal(diagnostic.causalGroups[0].canonicalOwner, "dsh-backend");
  assert.equal(diagnostic.causalGroups[0].rootCandidate, null);
  assert.equal(diagnostic.causalGroups[0].confidence, "UNCLASSIFIED");
  assert.equal(diagnostic.causalGroups[0].groupingBasis, "SHARED_CANONICAL_OWNER_HINT_ONLY_NOT_CAUSAL_PROOF");
});

test("external action failures join the same closure diagnostic", () => {
  const diagnostic = buildClosureDiagnostic({
    metadata: { kind: "security", sha: "abc" },
    externalRecords: [{ name: "dependency-review", outcome: "failure", source: "actions/dependency-review-action@sha" }],
  });
  assert.equal(diagnostic.findings.length, 1);
  assert.equal(diagnostic.findings[0].kind, "EXTERNAL_ACTION_FAILURE");
  assert.deepEqual(diagnostic.closure.smallestFalsifyingProof, ["dependency-review"]);
});

test("read-only repository verifiers execute under the canonical coverage process", async () => {
  for (const modulePath of [
    "./verify-doc-command-parity.mjs",
    "./verify-knowledge-references.mjs",
    "./verify-workspace-dependencies.mjs",
  ]) {
    await import(modulePath);
  }
});
