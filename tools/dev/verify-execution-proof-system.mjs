import fs from "node:fs";
import path from "node:path";
import "./execution-proof-system.mjs";
import "./verify-ci-exact-sha.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const fail = (message) => {
  console.error(`EXECUTION_PROOF_CONTRACT=FAIL ${message}`);
  process.exit(1);
};
const requireTokens = (body, label, tokens) => {
  for (const token of tokens) if (!body.includes(token)) fail(`${label} missing ${token}`);
};
const forbidTokens = (body, label, tokens) => {
  for (const token of tokens) if (body.includes(token)) fail(`${label} retains forbidden ${token}`);
};

const runtimeProof = read("tools/dev/verify-dsh-runtime-core.mjs");
const staleSettlementContracts = [
  'evidenceReference: `wallet-receipt-${suffix}`',
  'statementReference: `official-wallet-statement-${suffix}`',
];
const requiredSettlementContracts = [
  '"/dsh/operator/finance-evidence-documents"',
  '"TRANSFER_RECEIPT"',
  '"SETTLEMENT_STATEMENT"',
  "receiptDocumentId: transferReceiptDocumentID",
  "statementRowId: settlementStatementRowID",
  "settlementStatementRowRecorded",
];

for (const stale of staleSettlementContracts) {
  if (runtimeProof.includes(stale)) fail(`stale settlement proof contract=${stale}`);
}
for (const required of requiredSettlementContracts) {
  if (!runtimeProof.includes(required)) fail(`missing settlement proof contract=${required}`);
}
console.log("RUNTIME_SETTLEMENT_PROOF_CONTRACT=PASS evidence=canonical reconciliation=statement-row");

const agents = read("AGENTS.md");
requireTokens(agents, "AGENTS.md", [
  "PASS EVIDENCE REUSE",
  "RED CANDIDATE LAW",
  "ACTIVE_CLOSURE_BLOCKER",
  "NO GREENWASHING / ORACLE PRESERVATION",
  "Blind retry is forbidden",
]);

const localVerifier = read("tools/dev/verify-local-candidate.ps1");
requireTokens(localVerifier, "local verifier", [
  "VERIFY_BASE_SOURCE=REMOTE_TRACKING",
  "refs/remotes/origin/main",
  "VERIFY_SCOPE_AUTHORITY=NX_TASK_INPUTS_AND_AFFECTED_GRAPH",
  "repository-ci:execution-proof-system",
  "nx affected -t lint format-check typecheck unit contract build vet",
]);
forbidTokens(localVerifier, "local verifier", [
  "HEAD^",
  "Test-ChangedPath",
  "workspaceSensitivePatterns",
  "deployabilityPatterns",
  "infraPatterns",
  "export-smoke",
]);

const failureCapture = read("tools/dev/capture-ci-failure.mjs");
requireTokens(failureCapture, "failure capture", [
  "failure-summary.json",
  "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW",
  "progressionBlocked",
  "runtimeFailurePath",
  "failedNxTarget",
  "observedFailedTarget",
  "do not guess one",
]);
forbidTokens(failureCapture, "failure capture", ['"dsh-backend:runtime-proof"']);

const runtimeRunner = read("tools/dev/run-ci-runtime-proof.mjs");
requireTokens(runtimeRunner, "runtime runner", [
  "samrim-runtime-failure.json",
  "CI_RUNTIME_TASK=FAIL target=",
  "classify-highest-causal-root-before-new-material-work",
]);

const staticWorkflow = read(".github/workflows/ci-static.yml");
requireTokens(staticWorkflow, "static workflow diagnostics", [
  "run-ci-command.mjs static-invariants",
  "run-ci-command.mjs static-execution-proof",
  "run-ci-command.mjs static-go-workspace",
  "run-ci-command.mjs static-compose-config",
]);

console.log("FAILURE_DRIVEN_CLOSURE_CONTRACT=PASS pass=reuse fail=block-and-repair affected=nx-only diagnostics=causal");
