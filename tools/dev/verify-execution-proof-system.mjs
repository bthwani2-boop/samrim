import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "./execution-proof-system.mjs";
import "./verify-ci-exact-sha.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const fail = (message) => { console.error(`EXECUTION_PROOF_CONTRACT=FAIL ${message}`); process.exit(1); };
const requireTokens = (body, label, tokens) => { for (const token of tokens) if (!body.includes(token)) fail(`${label} missing ${token}`); };
const forbidTokens = (body, label, tokens) => { for (const token of tokens) if (body.includes(token)) fail(`${label} retains forbidden ${token}`); };

const runtimeProof = read("tools/dev/verify-dsh-runtime-core.mjs");
for (const stale of ['evidenceReference: `wallet-receipt-${suffix}`', 'statementReference: `official-wallet-statement-${suffix}`']) if (runtimeProof.includes(stale)) fail(`stale settlement proof contract=${stale}`);
for (const required of ['"/dsh/operator/finance-evidence-documents"', '"TRANSFER_RECEIPT"', '"SETTLEMENT_STATEMENT"', "receiptDocumentId: transferReceiptDocumentID", "statementRowId: settlementStatementRowID", "settlementStatementRowRecorded"]) if (!runtimeProof.includes(required)) fail(`missing settlement proof contract=${required}`);
console.log("RUNTIME_SETTLEMENT_PROOF_CONTRACT=PASS evidence=canonical reconciliation=statement-row");

const agents = read("AGENTS.md");
requireTokens(agents, "AGENTS.md", ["CAUSAL DIAGNOSTIC CLOSURE LAW", "PASS EVIDENCE REUSE", "RED CANDIDATE LAW", "ACTIVE_CLOSURE_BLOCKER", "NO GREENWASHING / ORACLE PRESERVATION", "Blind retry is forbidden", "bounded diagnostic batch", "machine-readable"]);

const localVerifier = read("tools/dev/verify-local-candidate.ps1");
requireTokens(localVerifier, "local verifier", ["VERIFY_BASE_SOURCE=REMOTE_TRACKING", "refs/remotes/origin/main", "VERIFY_SCOPE_AUTHORITY=NX_TASK_INPUTS_AND_AFFECTED_GRAPH", "repository-ci:execution-proof-system", "'nx','affected'", "--nxBail=false", "capture-ci-failure.mjs", "closure-diagnostic.json"]);
forbidTokens(localVerifier, "local verifier", ["HEAD^", "Test-ChangedPath", "workspaceSensitivePatterns", "deployabilityPatterns", "infraPatterns", "export-smoke", "agent-diagnostic.json"]);

const failureCapture = read("tools/dev/capture-ci-failure.mjs");
requireTokens(failureCapture, "failure capture", ["closure-diagnostic.json", "buildClosureDiagnostic", "runtimeFailurePath", "do not guess one", "affectedProjects"]);
forbidTokens(failureCapture, "failure capture", ['"dsh-backend:runtime-proof"', "agent-diagnostic.json", "failure-summary.json", "buildAgentDiagnostic"]);

const diagnosticHelper = read("tools/dev/ci-failure-diagnostics.mjs");
requireTokens(diagnosticHelper, "closure diagnostic", ["CAUSAL_DIAGNOSTIC_CLOSURE", "EVIDENCE_ONLY_NOT_ROOT_CAUSE_AUTHORITY", "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW", "schemaVersion", "findings", "causalGroups", "SHARED_CANONICAL_OWNER_HINT_ONLY_NOT_CAUSAL_PROOF", "highestPriorityRoot", "smallestFalsifyingProof", "NEVER_INFER_AN_UNPROVEN_ROOT_CAUSE", "RERUN_ONLY_MATERIALLY_INVALIDATED_EVIDENCE"]);
forbidTokens(diagnosticHelper, "closure diagnostic", ["AGENT_FAILURE_DIAGNOSTIC"]);
execFileSync(process.execPath, ["--test", "tools/dev/ci-failure-diagnostics.test.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tools/dev/verify-pr-policy.test.mjs"], { cwd: root, stdio: "inherit" });

const runtimeRunner = read("tools/dev/run-ci-runtime-proof.mjs");
requireTokens(runtimeRunner, "runtime runner", ["samrim-runtime-failure.json", "CI_RUNTIME_TASK=FAIL target=", "classify-highest-causal-root-before-new-material-work"]);
const commandRunner = read("tools/dev/run-ci-command.mjs");
requireTokens(commandRunner, "command runner", ["QUIET_SUCCESS_BOUNDED_FAILURE_RAW_ARTIFACT", "CI_TIMED_COMMAND_OUTPUT_TRUNCATED"]);
for (const [file, kind] of [["ci-static.yml", "static"], ["ci-runtime.yml", "runtime"], ["ci-policy.yml", "policy"], ["ci-security.yml", "security"]]) {
  const workflow = read(`.github/workflows/${file}`);
  requireTokens(workflow, `${kind} workflow diagnostics`, ["capture-ci-failure.mjs", "actions/upload-artifact@"]);
}
const policyWorkflow = read(".github/workflows/ci-policy.yml");
requireTokens(policyWorkflow, "policy bounded batch", ["run-ci-command.mjs policy-validation", "verify-pr-policy.mjs"]);
const policyVerifier = read("tools/dev/verify-pr-policy.mjs");
requireTokens(policyVerifier, "policy verifier", ["POLICY_FINDING=FAIL", "PR_POLICY=FAIL count=", "process.exit(0)"]);
const securityWorkflow = read(".github/workflows/ci-security.yml");
requireTokens(securityWorkflow, "security bounded batch", ["continue-on-error: true", "record-ci-external-result.mjs", "run-ci-command.mjs security-secret-safety", "enforce-ci-batch.mjs SECURITY"]);
const staticWorkflow = read(".github/workflows/ci-static.yml");
requireTokens(staticWorkflow, "static workflow diagnostics", ["run-ci-command.mjs static-invariants", "run-ci-command.mjs static-execution-proof", "run-ci-command.mjs static-go-workspace", "run-ci-command.mjs static-compose-config"]);
console.log("CAUSAL_DIAGNOSTIC_CLOSURE_CONTRACT=PASS pass=reuse fail=bounded-machine-diagnostic causal-root=prove-before-repair affected=nx-only artifact=closure-diagnostic-json");
